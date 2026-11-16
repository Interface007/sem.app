import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DsmNasGateway } from './dsm.js';

interface Recorded {
  method: string | undefined;
  url: string | undefined;
  body: URLSearchParams;
}

type Handler = (request: Recorded, respond: (status: number, body: string) => void) => void;

let server: Server;
let baseUrl: string;
let requests: Recorded[];
let handler: Handler;
const hangingSockets = new Set<Socket>();

async function readBody(request: IncomingMessage): Promise<string> {
  let data = '';
  for await (const chunk of request) data += String(chunk);
  return data;
}

beforeEach(async () => {
  requests = [];
  handler = (_request, respond) => respond(200, '{"success":true,"data":{"sid":"SID-123"}}');
  server = createServer((request, response) => {
    void readBody(request).then((raw) => {
      const recorded = { method: request.method, url: request.url, body: new URLSearchParams(raw) };
      requests.push(recorded);
      hangingSockets.add(request.socket);
      handler(recorded, (status, body) => {
        response.writeHead(status, { 'content-type': 'application/json' });
        response.end(body);
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  for (const socket of hangingSockets) socket.destroy();
  hangingSockets.clear();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.restoreAllMocks();
});

const credentials = { account: 'anna', password: 'pw&secret=1', otpCode: '123456' };

function failWith(code: number): Handler {
  return (_request, respond) => respond(200, JSON.stringify({ success: false, error: { code } }));
}

describe('DsmNasGateway.login', () => {
  it('returns the sid on success', async () => {
    const result = await new DsmNasGateway(baseUrl).login(credentials);
    expect(result).toEqual({ ok: true, session: { account: 'anna', sid: 'SID-123' } });
  });

  it('sends the documented form body via POST', async () => {
    await new DsmNasGateway(baseUrl).login(credentials);
    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request?.method).toBe('POST');
    expect(request?.url).toBe('/webapi/entry.cgi');
    expect(Object.fromEntries(request?.body ?? [])).toEqual({
      api: 'SYNO.API.Auth',
      version: '6',
      method: 'login',
      account: 'anna',
      passwd: 'pw&secret=1',
      session: 'FileStation',
      format: 'sid',
      otp_code: '123456',
    });
  });

  it('keeps credentials out of the URL and omits otp_code if none is given', async () => {
    await new DsmNasGateway(baseUrl).login({ account: 'anna', password: 'pw&secret=1' });
    const [request] = requests;
    expect(request?.url).not.toMatch(/anna|secret|passwd|account|otp/);
    expect(request?.body.has('otp_code')).toBe(false);
  });

  it.each([
    [400, 'invalid_credentials'],
    [403, 'otp_required'],
    [404, 'otp_invalid'],
    [401, 'account_blocked'],
    [402, 'account_blocked'],
    [406, 'account_blocked'],
    [407, 'account_blocked'],
    [408, 'account_blocked'],
    [409, 'account_blocked'],
    [410, 'account_blocked'],
    [100, 'unavailable'],
    [405, 'unavailable'],
  ])('maps DSM error %i to %s', async (code, reason) => {
    handler = failWith(code);
    expect(await new DsmNasGateway(baseUrl).login(credentials)).toEqual({ ok: false, reason });
  });

  it('reports unavailable when the answer is not JSON', async () => {
    handler = (_request, respond) => respond(200, '<html>nope</html>');
    expect(await new DsmNasGateway(baseUrl).login(credentials)).toEqual({
      ok: false,
      reason: 'unavailable',
    });
  });

  it('reports unavailable when the answer has an unexpected shape', async () => {
    handler = (_request, respond) => respond(200, '{"hello":"world"}');
    expect(await new DsmNasGateway(baseUrl).login(credentials)).toEqual({
      ok: false,
      reason: 'unavailable',
    });
  });

  it('reports unavailable on timeout', async () => {
    handler = () => {
      // never answer
    };
    expect(await new DsmNasGateway(baseUrl, 100).login(credentials)).toEqual({
      ok: false,
      reason: 'unavailable',
    });
  });

  it('reports unavailable when the connection fails', async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const port = (closed.address() as AddressInfo).port;
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    expect(await new DsmNasGateway(`http://127.0.0.1:${port}`).login(credentials)).toEqual({
      ok: false,
      reason: 'unavailable',
    });
  });
});

describe('DsmNasGateway.logout', () => {
  it('sends the sid in the POST body', async () => {
    await new DsmNasGateway(baseUrl).logout({ account: 'anna', sid: 'SID-123' });
    const [request] = requests;
    expect(request?.method).toBe('POST');
    expect(request?.url).not.toContain('SID-123');
    expect(Object.fromEntries(request?.body ?? [])).toEqual({
      api: 'SYNO.API.Auth',
      version: '6',
      method: 'logout',
      session: 'FileStation',
      _sid: 'SID-123',
    });
  });

  it('does not throw when the NAS is unreachable', async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const port = (closed.address() as AddressInfo).port;
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    await expect(
      new DsmNasGateway(`http://127.0.0.1:${port}`).logout({ account: 'anna', sid: 'SID-123' }),
    ).resolves.toBeUndefined();
  });
});

describe('secrets', () => {
  it('never appear in log output, also not on failures', async () => {
    const written: string[] = [];
    const capture = (chunk: unknown): boolean => {
      written.push(String(chunk));
      return true;
    };
    vi.spyOn(process.stdout, 'write').mockImplementation(capture);
    vi.spyOn(process.stderr, 'write').mockImplementation(capture);
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        written.push(args.map(String).join(' '));
      });
    }

    const secrets = { account: 'anna', password: 'pw-TOPSECRET', otpCode: '987654' };
    const gateway = new DsmNasGateway(baseUrl, 100);
    const results = [await gateway.login(secrets)];
    handler = failWith(400);
    results.push(await gateway.login(secrets));
    handler = (_request, respond) => respond(200, 'garbage');
    results.push(await gateway.login(secrets));
    handler = () => {
      // never answer
    };
    results.push(await gateway.login(secrets));
    await gateway.logout({ account: 'anna', sid: 'SID-123' });

    const sid = 'SID-123';
    const everything = written.join('\n') + JSON.stringify(results.slice(1));
    for (const secret of [secrets.password, secrets.otpCode, sid]) {
      expect(everything).not.toContain(secret);
    }
  });
});
