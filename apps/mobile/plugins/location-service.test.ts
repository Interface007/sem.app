import { describe, expect, it } from 'vitest';
import { type AndroidManifestLike, ensureLocationService } from './location-service';

function manifest(): AndroidManifestLike {
  return {
    manifest: {
      $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' },
      'uses-permission': [{ $: { 'android:name': 'android.permission.INTERNET' } }],
      application: [{ service: [] }],
    },
  };
}

const names = (m: AndroidManifestLike) =>
  (m.manifest['uses-permission'] ?? []).map((p) => p.$['android:name']);

describe('ensureLocationService', () => {
  const result = ensureLocationService(manifest());

  it('adds the permissions Android 14 requires and keeps the others', () => {
    expect(names(result)).toEqual(
      expect.arrayContaining([
        'android.permission.INTERNET',
        'android.permission.FOREGROUND_SERVICE',
        'android.permission.FOREGROUND_SERVICE_LOCATION',
        'android.permission.ACCESS_BACKGROUND_LOCATION',
        'android.permission.POST_NOTIFICATIONS',
      ]),
    );
  });

  it('declares the service with foregroundServiceType="location"', () => {
    const service = result.manifest.application?.[0]?.service?.[0];
    expect(service?.$['android:name']).toBe('expo.modules.location.services.LocationTaskService');
    expect(service?.$['android:foregroundServiceType']).toBe('location');
    expect(result.manifest.$?.['xmlns:tools']).toBeDefined();
  });

  it('is idempotent and corrects a wrong service type', () => {
    const wrong = manifest();
    wrong.manifest.application = [
      {
        service: [
          {
            $: {
              'android:name': 'expo.modules.location.services.LocationTaskService',
              'android:foregroundServiceType': 'dataSync',
            },
          },
        ],
      },
    ];
    const once = ensureLocationService(wrong);
    const snapshot = JSON.stringify(once);
    expect(JSON.stringify(ensureLocationService(once))).toBe(snapshot);
    expect(once.manifest.application?.[0]?.service).toHaveLength(1);
    expect(once.manifest.application?.[0]?.service?.[0]?.$['android:foregroundServiceType']).toBe(
      'location',
    );
  });

  it('fails loudly without an application element', () => {
    expect(() => ensureLocationService({ manifest: {} })).toThrow(/no application element/);
  });
});
