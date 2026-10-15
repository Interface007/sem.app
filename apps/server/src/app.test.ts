import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Health } from '@sem/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

describe('GET /health', () => {
  it('answers with status, version and commit', async () => {
    const app = await buildApp({ version: '1.2.3', commit: 'abc1234', webRoot: undefined });
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    const body = Health.parse(response.json());
    expect(body).toEqual({ status: 'ok', version: '1.2.3', commit: 'abc1234' });
    await app.close();
  });

  it('fails instead of answering with a value that violates the contract', async () => {
    const app = await buildApp({ version: '', commit: 'abc1234', webRoot: undefined });
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(500);
    await app.close();
  });
});

describe('web root', () => {
  let webRoot: string;

  beforeAll(async () => {
    webRoot = await mkdtemp(path.join(tmpdir(), 'sem-web-'));
    await writeFile(path.join(webRoot, 'index.html'), '<!doctype html><title>sem</title>');
    await writeFile(path.join(webRoot, 'app.js'), 'console.log(1);');
  });

  afterAll(async () => {
    await rm(webRoot, { recursive: true, force: true });
  });

  it('serves files from the configured folder', async () => {
    const app = await buildApp({ version: '1', commit: 'c', webRoot });
    const response = await app.inject({ method: 'GET', url: '/app.js' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('console.log(1);');
    await app.close();
  });

  it('answers client-side routes with the app shell', async () => {
    const app = await buildApp({ version: '1', commit: 'c', webRoot });
    const response = await app.inject({
      method: 'GET',
      url: '/haus',
      headers: { accept: 'text/html' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('<title>sem</title>');
    await app.close();
  });

  it('keeps 404 for missing assets', async () => {
    const app = await buildApp({ version: '1', commit: 'c', webRoot });
    const response = await app.inject({ method: 'GET', url: '/missing.js' });

    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it('serves nothing when no folder is configured', async () => {
    const app = await buildApp({ version: '1', commit: 'c', webRoot: undefined });
    const response = await app.inject({
      method: 'GET',
      url: '/',
      headers: { accept: 'text/html' },
    });

    expect(response.statusCode).toBe(404);
    await app.close();
  });
});
