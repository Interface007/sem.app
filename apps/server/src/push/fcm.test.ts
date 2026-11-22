import { createVerify, generateKeyPairSync } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FcmPushSender } from './fcm.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const account = {
  type: 'service_account',
  project_id: 'sem-family',
  client_email: 'push@sem-family.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  token_uri: 'https://oauth2.example.test/token',
};

interface Call {
  url: string;
  init: RequestInit;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('FcmPushSender', () => {
  let dir: string;
  let file: string;
  let calls: Call[];
  let sendAnswers: Response[];
  let time: number;
  let warnings: string[];

  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    if (String(url) === account.token_uri) {
      return json(200, { access_token: 'access-1', expires_in: 3600 });
    }
    return sendAnswers.shift() ?? json(200, { name: 'projects/sem-family/messages/1' });
  }) as typeof fetch;

  const sender = () =>
    new FcmPushSender({
      serviceAccountFile: file,
      fetch: fakeFetch,
      now: () => time,
      warn: (m) => warnings.push(m),
    });

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'sem-fcm-'));
    file = path.join(dir, 'account.json');
    await writeFile(file, JSON.stringify(account));
    calls = [];
    sendAnswers = [];
    time = Date.UTC(2026, 0, 1, 12);
    warnings = [];
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('gets an access token with a signed JWT and sends a high-priority data message', async () => {
    const outcome = await sender().send('device-token', { type: 'location-boost' }, 600);
    expect(outcome).toBe('sent');

    const [tokenCall, sendCall] = calls;
    const form = new URLSearchParams(String(tokenCall?.init.body));
    expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    const [header = '', claims = '', signature = ''] = (form.get('assertion') ?? '').split('.');
    const verify = createVerify('RSA-SHA256').update(`${header}.${claims}`);
    expect(verify.verify(publicKey, Buffer.from(signature, 'base64url'))).toBe(true);
    expect(JSON.parse(Buffer.from(claims, 'base64url').toString())).toMatchObject({
      iss: account.client_email,
      aud: account.token_uri,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      iat: time / 1000,
      exp: time / 1000 + 3600,
    });

    expect(sendCall?.url).toBe('https://fcm.googleapis.com/v1/projects/sem-family/messages:send');
    expect(new Headers(sendCall?.init.headers).get('authorization')).toBe('Bearer access-1');
    expect(JSON.parse(String(sendCall?.init.body))).toEqual({
      message: {
        token: 'device-token',
        data: { type: 'location-boost' },
        android: { priority: 'HIGH', ttl: '600s' },
      },
    });
  });

  it('reuses the access token until shortly before it expires', async () => {
    const push = sender();
    await push.send('t', {}, 1);
    time += 58 * 60 * 1000;
    await push.send('t', {}, 1);
    expect(calls.filter((c) => c.url === account.token_uri)).toHaveLength(1);
    time += 60 * 1000;
    await push.send('t', {}, 1);
    expect(calls.filter((c) => c.url === account.token_uri)).toHaveLength(2);
  });

  it.each([
    ['404', json(404, { error: { status: 'NOT_FOUND' } })],
    [
      '400 UNREGISTERED',
      json(400, {
        error: { details: [{ '@type': 'x.FcmError', errorCode: 'UNREGISTERED' }] },
      }),
    ],
  ])('reports an invalid token for %s', async (_name, answer) => {
    sendAnswers = [answer];
    expect(await sender().send('t', {}, 1)).toBe('invalid_token');
  });

  it('reports other errors as failed and warns without the token', async () => {
    sendAnswers = [json(503, {})];
    expect(await sender().send('secret-device-token', {}, 1)).toBe('failed');
    expect(warnings).toEqual(['FCM answered 503']);
  });

  it('never throws, e.g. for a missing service account file', async () => {
    file = path.join(dir, 'missing.json');
    expect(await sender().send('t', {}, 1)).toBe('failed');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).not.toContain(dir);
  });
});
