import { type ConfigPlugin, withAndroidManifest } from 'expo/config-plugins';

/*
 * Android 14+ refuses to start a foreground service of type "location" without
 * the matching permissions and a declared service type. expo-location adds them
 * through its plugin options; this plugin guarantees them regardless, so the
 * app cannot crash when the system restarts the service.
 *
 * expo-task-manager schedules a persisted JobScheduler job for every location
 * update the background task receives. Android rejects persisted jobs without
 * RECEIVE_BOOT_COMPLETED and the app crashes natively on start (#46).
 */

const PERMISSIONS = [
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_LOCATION',
  'android.permission.ACCESS_BACKGROUND_LOCATION',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.RECEIVE_BOOT_COMPLETED',
];

const SERVICE_NAME = 'expo.modules.location.services.LocationTaskService';

interface ManifestNode {
  $: Record<string, string | undefined>;
}

export interface AndroidManifestLike {
  manifest: {
    $?: Record<string, string | undefined>;
    'uses-permission'?: ManifestNode[];
    application?: { service?: ManifestNode[] }[];
  };
}

/** Adds the missing permissions and the `location` service type to a parsed AndroidManifest.xml. */
export function ensureLocationService<T extends AndroidManifestLike>(androidManifest: T): T {
  const manifest = androidManifest.manifest;
  manifest.$ = { 'xmlns:tools': 'http://schemas.android.com/tools', ...manifest.$ };

  const permissions = (manifest['uses-permission'] ??= []);
  for (const name of PERMISSIONS) {
    const existing = permissions.find((p) => p.$['android:name'] === name);
    if (!existing) {
      permissions.push({ $: { 'android:name': name } });
    } else if (existing.$['tools:node'] === 'remove') {
      // A blocked permission would otherwise be stripped again by the manifest merger.
      delete existing.$['tools:node'];
    }
  }

  const application = manifest.application?.[0];
  if (!application) throw new Error('location-service: no application element in the manifest');
  const services = (application.service ??= []);
  let service = services.find((s) => s.$['android:name'] === SERVICE_NAME);
  if (!service) {
    service = { $: { 'android:name': SERVICE_NAME } };
    services.push(service);
  }
  service.$['android:foregroundServiceType'] = 'location';
  service.$['tools:replace'] = 'android:foregroundServiceType';
  return androidManifest;
}

export const withLocationService: ConfigPlugin = (config) =>
  withAndroidManifest(config, (mod) => {
    ensureLocationService(mod.modResults);
    return mod;
  });
