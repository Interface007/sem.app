import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { taskDeps } from './adapter';
import { LOCATION_TASK_NAME } from './constants';
import { handleLocationBatch, type MeasuredLocation } from './report';

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown error';
}

/** Registers the background task; errors are logged, never thrown (they would end the app). */
export function registerLocationTask(): void {
  try {
    TaskManager.defineTask<{ locations: MeasuredLocation[] }>(
      LOCATION_TASK_NAME,
      async ({ data, error }) => {
        try {
          if (error || !data) return;
          await handleLocationBatch(data.locations, taskDeps);
        } catch (failure) {
          console.warn('location task failed', errorName(failure));
        }
      },
    );
  } catch (failure) {
    console.warn('location task registration failed', errorName(failure));
  }
}

// Must run at module level: Android may start the app without any UI.
if (Platform.OS === 'android') registerLocationTask();
