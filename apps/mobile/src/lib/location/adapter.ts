import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import { PermissionsAndroid, Platform } from 'react-native';
import { apiFetch } from '../apiFetch';
import { session } from '../sessionClient';
import { tokenStore } from '../tokenStore';
import { LOCATION_TASK_NAME } from './constants';
import type { TaskDeps } from './report';
import { createSharingSettings, randomUuid } from './settings';
import { createLocationSharing, type LocationApi } from './sharing';

/** Counterpart of `LOCATION_INTERVAL_MS`: high accuracy means continuous GPS. */
export const LOCATION_ACCURACY = Location.Accuracy.High;

export const sharingSettings = createSharingSettings(
  {
    get: (key) => SecureStore.getItemAsync(key),
    set: (key, value) => SecureStore.setItemAsync(key, value),
  },
  randomUuid,
);

const expoLocationApi: LocationApi = {
  async requestForeground() {
    return (await Location.requestForegroundPermissionsAsync()).granted;
  },
  async requestNotifications() {
    // Android 12 and older have no runtime permission for notifications.
    if (Platform.OS !== 'android' || Number(Platform.Version) < 33) return true;
    const result = await PermissionsAndroid.request('android.permission.POST_NOTIFICATIONS');
    return result === PermissionsAndroid.RESULTS.GRANTED;
  },
  async requestBackground() {
    return (await Location.requestBackgroundPermissionsAsync()).granted;
  },
  startUpdates: (options) =>
    Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
      accuracy: LOCATION_ACCURACY,
      ...options,
    }),
  async stopUpdates() {
    if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME)) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
    }
  },
  hasStarted: () => Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME),
  async hasPermissions() {
    const foreground = await Location.getForegroundPermissionsAsync();
    if (!foreground.granted) return false;
    return (await Location.getBackgroundPermissionsAsync()).granted;
  },
};

export const locationSharing = createLocationSharing({
  api: expoLocationApi,
  settings: sharingSettings,
  authFetch: session.authFetch,
});

const model = (Platform.constants as { Model?: string } | undefined)?.Model;

export const taskDeps: TaskDeps = {
  apiFetch,
  getToken: () => tokenStore.get(),
  settings: sharingSettings,
  now: () => Date.now(),
  stopUpdates: expoLocationApi.stopUpdates,
  deviceName: (model || 'Android').slice(0, 60),
};
