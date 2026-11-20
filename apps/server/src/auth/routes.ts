import {
  ApiError,
  LoginRequest,
  LoginResponse,
  SessionResponse,
  type ApiErrorCode,
} from '@sem/contracts';
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preHandlerAsyncHookHandler,
} from 'fastify';
import type { NasGateway, NasLoginFailure } from '../nas/gateway.js';
import { LoginLimiter } from './login-limiter.js';
import type { Session, SessionService } from './session-service.js';

export const SESSION_COOKIE = 'sem_session';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by `requireSession`. */
    session: Pick<Session, 'id' | 'user'> & { expiresAt: number };
  }
  interface FastifyInstance {
    /** `preHandler` hook that answers 401 `unauthenticated` without a valid session. */
    requireSession: preHandlerAsyncHookHandler;
  }
}

const MESSAGES: Record<ApiErrorCode, string> = {
  invalid_request: 'Die Anfrage ist ungültig.',
  invalid_credentials: 'Benutzername oder Passwort ist falsch.',
  otp_required: 'Bitte den Bestätigungscode eingeben.',
  otp_invalid: 'Der Bestätigungscode ist falsch.',
  account_blocked: 'Das Konto ist gesperrt.',
  nas_unavailable: 'Die NAS ist derzeit nicht erreichbar.',
  haus_unavailable: 'Das Haus-Modell ist derzeit nicht erreichbar.',
  rate_limited: 'Zu viele Fehlversuche. Bitte später erneut versuchen.',
  unauthenticated: 'Bitte anmelden.',
  forbidden: 'Dieser Eintrag gehört einem anderen Benutzer.',
};

const FAILURES: Record<NasLoginFailure, { status: number; code: ApiErrorCode }> = {
  invalid_credentials: { status: 401, code: 'invalid_credentials' },
  otp_required: { status: 401, code: 'otp_required' },
  otp_invalid: { status: 401, code: 'otp_invalid' },
  account_blocked: { status: 403, code: 'account_blocked' },
  unavailable: { status: 503, code: 'nas_unavailable' },
};

/** Failures that count towards the rate limit; `otp_required` is a normal step. */
const COUNTED: readonly NasLoginFailure[] = ['invalid_credentials', 'otp_invalid'];

export function sendError(reply: FastifyReply, status: number, code: ApiErrorCode): FastifyReply {
  return reply
    .code(status)
    .header('Cache-Control', 'no-store')
    .send(ApiError.parse({ error: code, message: MESSAGES[code] }));
}

function cookieValue(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const separator = part.indexOf('=');
    if (separator > 0 && part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }
  return undefined;
}

/** Bearer token first, then the session cookie. */
function extractToken(request: FastifyRequest): string | undefined {
  const authorization = request.headers.authorization;
  if (authorization !== undefined) {
    const match = /^Bearer +(\S+)$/i.exec(authorization);
    if (match?.[1] !== undefined) return match[1];
  }
  const cookie = cookieValue(request.headers.cookie, SESSION_COOKIE);
  return cookie === '' ? undefined : cookie;
}

function cookieHeader(request: FastifyRequest, value: string, maxAgeSeconds: number): string {
  const secure = request.protocol === 'https' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${value}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; SameSite=Strict${secure}`;
}

export interface AuthDeps {
  nasGateway: NasGateway;
  sessions: SessionService;
  now: () => number;
}

export function registerAuth(app: FastifyInstance, deps: AuthDeps): void {
  const { nasGateway, sessions, now } = deps;
  const limiter = new LoginLimiter(now);

  app.decorateRequest('session');
  app.decorate('requireSession', async (request, reply) => {
    const token = extractToken(request);
    const session = token === undefined ? undefined : sessions.authenticate(token);
    if (session === undefined) {
      return sendError(reply, 401, 'unauthenticated');
    }
    request.session = { id: session.id, user: session.user, expiresAt: session.expiresAt };
    return undefined;
  });

  app.post('/api/auth/login', async (request, reply) => {
    const parsed = LoginRequest.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'invalid_request');
    const { username, password, otp, tokenDelivery } = parsed.data;
    const key = username.toLowerCase();

    const retryAfter = limiter.retryAfterSeconds(key);
    if (retryAfter !== undefined) {
      void reply.header('Retry-After', String(retryAfter));
      return sendError(reply, 429, 'rate_limited');
    }

    let result;
    try {
      result = await nasGateway.login({
        account: username,
        password,
        ...(otp === undefined ? {} : { otpCode: otp }),
      });
    } catch {
      // Not logged: the error could carry request details.
      request.log.error('NAS gateway login failed unexpectedly');
      return sendError(reply, 503, 'nas_unavailable');
    }

    if (!result.ok) {
      if (COUNTED.includes(result.reason)) limiter.recordFailure(key);
      const failure = FAILURES[result.reason];
      return sendError(reply, failure.status, failure.code);
    }

    limiter.reset(key);
    const user = { name: result.session.account.toLowerCase() };
    const created = sessions.create(user.name, result.session.sid);
    const expiresAt = new Date(created.expiresAt).toISOString();
    void reply.header('Cache-Control', 'no-store');
    if (tokenDelivery === 'cookie') {
      void reply.header(
        'Set-Cookie',
        cookieHeader(request, created.token, Math.floor(sessions.ttlMs / 1000)),
      );
      return LoginResponse.parse({ user, expiresAt });
    }
    return LoginResponse.parse({ user, expiresAt, token: created.token });
  });

  app.get('/api/auth/session', { preHandler: app.requireSession }, async (request, reply) => {
    void reply.header('Cache-Control', 'no-store');
    return SessionResponse.parse({
      user: { name: request.session.user },
      expiresAt: new Date(request.session.expiresAt).toISOString(),
    });
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const token = extractToken(request);
    const session = token === undefined ? undefined : sessions.authenticate(token);
    if (session !== undefined) {
      sessions.revoke(session.id);
      try {
        await nasGateway.logout({ account: session.user, sid: session.sid });
      } catch {
        request.log.warn('DSM logout failed; the app session is revoked anyway');
      }
    }
    return reply
      .header('Set-Cookie', cookieHeader(request, '', 0))
      .header('Cache-Control', 'no-store')
      .code(204)
      .send();
  });
}
