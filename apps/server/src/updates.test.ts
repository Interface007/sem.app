import { createHash, createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { UpdateManifest } from '@sem/contracts';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

const RUNTIME = 'runtime-1';
const headers = {
  'expo-protocol-version': '1',
  'expo-platform': 'android',
  'expo-runtime-version': RUNTIME,
};
const BUNDLE = '_expo/static/js/android/entry-abc.hbc';
const IMAGE = 'assets/0123abcd';

let root: string;
let dir: string;
let keyPath: string;
let publicKeyPem: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'sem-updates-'));
  dir = path.join(root, 'export');
  await mkdir(path.join(dir, '_expo/static/js/android'), { recursive: true });
  await mkdir(path.join(dir, 'assets'));
  await writeFile(path.join(dir, BUNDLE), 'bundle-bytes');
  await writeFile(path.join(dir, IMAGE), 'png-bytes');
  await writeFile(
    path.join(dir, 'metadata.json'),
    JSON.stringify({
      version: 0,
      fileMetadata: { android: { bundle: BUNDLE, assets: [{ path: IMAGE, ext: 'png' }] } },
    }),
  );
  await writeFile(path.join(dir, 'expoConfig.json'), JSON.stringify({ runtimeVersion: RUNTIME }));
  await writeFile(path.join(root, 'secret.txt'), 'outside');
  await symlink(path.join(root, 'secret.txt'), path.join(dir, 'link.txt'));

  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  keyPath = path.join(root, 'key.pem');
  await writeFile(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

async function app(
  overrides: { updatesDir?: string | undefined; updatesPrivateKeyPath?: string | undefined } = {},
): Promise<FastifyInstance> {
  return buildApp({
    version: '1',
    commit: 'c',
    webRoot: undefined,
    updatesDir: dir,
    updatesPrivateKeyPath: keyPath,
    updatesBaseUrl: 'https://sem.example',
    ...overrides,
  });
}

function parsePart(body: string): { partHeaders: string; json: string } {
  const [partHeaders = '', json = ''] = body.split('\r\n\r\n');
  return { partHeaders, json: json.split('\r\n--')[0] ?? '' };
}

describe('GET /api/updates/manifest', () => {
  it('serves a signed multipart manifest whose hashes match the files', async () => {
    const server = await app();
    const response = await server.inject({
      method: 'GET',
      url: '/api/updates/manifest',
      headers,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/^multipart\/mixed; boundary=/);
    expect(response.headers['cache-control']).toBe('private, max-age=0');
    const { partHeaders, json } = parsePart(response.body);
    expect(partHeaders).toContain('name="manifest"');

    const manifest = UpdateManifest.parse(JSON.parse(json));
    expect(manifest.runtimeVersion).toBe(RUNTIME);
    const sha = (text: string): string =>
      createHash('sha256').update(text).digest().toString('base64url');
    expect(manifest.launchAsset.hash).toBe(sha('bundle-bytes'));
    expect(manifest.launchAsset.url).toBe(`https://sem.example/api/updates/assets/${BUNDLE}`);
    expect(manifest.assets).toHaveLength(1);
    expect(manifest.assets[0]).toMatchObject({
      hash: sha('png-bytes'),
      contentType: 'image/png',
      fileExtension: '.png',
    });

    const signature = /expo-signature: sig="([^"]+)", keyid="main", alg="rsa-v1_5-sha256"/.exec(
      partHeaders,
    )?.[1];
    expect(signature).toBeDefined();
    expect(
      verify(
        'sha256',
        Buffer.from(json),
        createPublicKey(publicKeyPem),
        Buffer.from(signature ?? '', 'base64'),
      ),
    ).toBe(true);
    await server.close();
  });

  it('serves assets whose bytes match the manifest hash', async () => {
    const server = await app();
    const manifestResponse = await server.inject({
      method: 'GET',
      url: '/api/updates/manifest',
      headers,
    });
    const manifest = UpdateManifest.parse(JSON.parse(parsePart(manifestResponse.body).json));
    const url = new URL(manifest.launchAsset.url);
    const asset = await server.inject({ method: 'GET', url: url.pathname });

    expect(asset.statusCode).toBe(200);
    expect(createHash('sha256').update(asset.rawPayload).digest().toString('base64url')).toBe(
      manifest.launchAsset.hash,
    );
    await server.close();
  });

  it.each([
    ['another platform', { ...headers, 'expo-platform': 'ios' }],
    ['no runtime version', { ...headers, 'expo-runtime-version': '' }],
    ['no protocol version', { 'expo-platform': 'android', 'expo-runtime-version': RUNTIME }],
  ])('answers 400 for %s', async (_name, requestHeaders) => {
    const server = await app();
    const response = await server.inject({
      method: 'GET',
      url: '/api/updates/manifest',
      headers: requestHeaders,
    });

    expect(response.statusCode).toBe(400);
    await server.close();
  });

  it('answers 204 for a different runtime version', async () => {
    const server = await app();
    const response = await server.inject({
      method: 'GET',
      url: '/api/updates/manifest',
      headers: { ...headers, 'expo-runtime-version': 'other' },
    });

    expect(response.statusCode).toBe(204);
    await server.close();
  });

  it('answers 204 without an export', async () => {
    const server = await app({ updatesDir: path.join(root, 'missing') });
    const response = await server.inject({
      method: 'GET',
      url: '/api/updates/manifest',
      headers,
    });

    expect(response.statusCode).toBe(204);
    await server.close();
  });

  it.each([
    ['not configured', undefined],
    ['unreadable', '/nonexistent/key.pem'],
  ])('answers 204 and never an unsigned manifest when the key is %s', async (_name, keyFile) => {
    const server = await app({ updatesPrivateKeyPath: keyFile });
    const response = await server.inject({
      method: 'GET',
      url: '/api/updates/manifest',
      headers,
    });

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
    await server.close();
  });
});

describe('GET /api/updates/assets/*', () => {
  it('serves files with immutable cache headers', async () => {
    const server = await app();
    const response = await server.inject({ method: 'GET', url: `/api/updates/assets/${IMAGE}` });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('png-bytes');
    expect(response.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    await server.close();
  });

  it.each([
    ['dot-dot segments', '/api/updates/assets/../secret.txt'],
    ['encoded dot-dot segments', '/api/updates/assets/%2e%2e/secret.txt'],
    ['encoded slashes', '/api/updates/assets/..%2fsecret.txt'],
    ['symlinks leaving the folder', '/api/updates/assets/link.txt'],
    ['directories', '/api/updates/assets/assets'],
    ['missing files', '/api/updates/assets/nope'],
  ])('rejects %s', async (_name, url) => {
    const server = await app();
    const response = await server.inject({ method: 'GET', url });

    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain('outside');
    await server.close();
  });

  it('serves nothing when no folder is configured', async () => {
    const server = await app({ updatesDir: undefined });
    const response = await server.inject({ method: 'GET', url: `/api/updates/assets/${IMAGE}` });

    expect(response.statusCode).toBe(404);
    await server.close();
  });
});
