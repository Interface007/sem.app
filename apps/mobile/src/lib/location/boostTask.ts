import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { locationSharing } from './adapter';
import { boostFromPushPayload } from './boostPush';
import { BOOST_PUSH_TASK_NAME } from './constants';
import { formatClock } from './sharing';

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown error';
}

/**
 * Tells the person that they are being followed live. Also keeps FCM from
 * deprioritising later high-priority messages, which it does for messages
 * that lead to nothing visible.
 */
async function announce(boostUntil: number): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Live-Verfolgung aktiv',
      body: `Ein Familienmitglied sieht deinen Standort bis ${formatClock(boostUntil)} alle 10 Sekunden.`,
    },
    trigger: null,
  });
}

/** Defines and registers the task; errors are logged, never thrown (they would end the app). */
export function registerBoostPushTask(): void {
  try {
    Notifications.setNotificationHandler({
      handleNotification: () =>
        Promise.resolve({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: false,
          shouldSetBadge: false,
        }),
    });
    TaskManager.defineTask(BOOST_PUSH_TASK_NAME, async ({ data }) => {
      try {
        const boostUntil = boostFromPushPayload(data);
        if (boostUntil === undefined || boostUntil <= Date.now()) return;
        // An FCM high-priority message allows the switch while the app is in the background.
        await locationSharing.applyBoost(boostUntil);
        await announce(boostUntil);
      } catch (failure) {
        console.warn('boost push failed', errorName(failure));
      }
    });
    void Notifications.registerTaskAsync(BOOST_PUSH_TASK_NAME).catch((failure: unknown) => {
      console.warn('boost push registration failed', errorName(failure));
    });
  } catch (failure) {
    console.warn('boost push task registration failed', errorName(failure));
  }
}

// Must run at module level: FCM may start the app without any UI.
if (Platform.OS === 'android') registerBoostPushTask();
