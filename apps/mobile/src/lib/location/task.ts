import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { taskDeps } from './adapter';
import { LOCATION_TASK_NAME } from './constants';
import { handleLocationBatch, type MeasuredLocation } from './report';

// Must run at module level: Android may start the app without any UI.
if (Platform.OS === 'android') {
  TaskManager.defineTask<{ locations: MeasuredLocation[] }>(
    LOCATION_TASK_NAME,
    async ({ data, error }) => {
      if (error || !data) return;
      await handleLocationBatch(data.locations, taskDeps);
    },
  );
}
