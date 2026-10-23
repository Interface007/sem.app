import { describe, expect, it } from 'vitest';
import { ExportMetadata, UpdateManifest, UpdateRequestHeaders } from './updates.js';

const hash = 'A'.repeat(43);
const asset = { hash, key: 'k', contentType: 'image/png', url: 'http://x/a' };

describe('UpdateRequestHeaders', () => {
  const valid = {
    'expo-protocol-version': '1',
    'expo-platform': 'android',
    'expo-runtime-version': 'abc',
  };

  it('accepts the required headers', () => {
    expect(UpdateRequestHeaders.parse(valid)['expo-runtime-version']).toBe('abc');
  });

  it.each([
    ['other platform', { ...valid, 'expo-platform': 'ios' }],
    ['missing runtime version', { ...valid, 'expo-runtime-version': undefined }],
    ['other protocol version', { ...valid, 'expo-protocol-version': '0' }],
  ])('rejects %s', (_name, headers) => {
    expect(UpdateRequestHeaders.safeParse(headers).success).toBe(false);
  });
});

describe('UpdateManifest', () => {
  const manifest = {
    id: '3f2b8c9e-5d4a-4b1e-9c3d-0a1b2c3d4e5f',
    createdAt: '2026-10-21T10:00:00.000Z',
    runtimeVersion: 'abc',
    launchAsset: asset,
    assets: [],
    metadata: {},
    extra: {},
  };

  it('accepts a complete manifest', () => {
    expect(UpdateManifest.safeParse(manifest).success).toBe(true);
  });

  it('rejects hashes that are not Base64URL(SHA-256)', () => {
    const bad = { ...manifest, launchAsset: { ...asset, hash: 'abc+/=' } };
    expect(UpdateManifest.safeParse(bad).success).toBe(false);
  });
});

describe('ExportMetadata', () => {
  it('reads the android part of an expo export', () => {
    const parsed = ExportMetadata.parse({
      version: 0,
      fileMetadata: { android: { bundle: 'b.hbc', assets: [{ path: 'assets/x', ext: 'png' }] } },
    });
    expect(parsed.fileMetadata.android.bundle).toBe('b.hbc');
  });
});
