export interface RunningUpdate {
  isEnabled: boolean;
  isEmbeddedLaunch: boolean;
  updateId: string | null;
}

/** Text for the settings screen: the running update ID or `eingebettet`. */
export function describeRunningUpdate({
  isEnabled,
  isEmbeddedLaunch,
  updateId,
}: RunningUpdate): string {
  if (!isEnabled) return 'Updates nicht verfügbar';
  if (isEmbeddedLaunch || !updateId) return 'eingebettet';
  return updateId;
}

/** The subset of `expo-updates` that the update check needs. */
export interface UpdatesApi {
  checkForUpdateAsync(): Promise<{ isAvailable: boolean }>;
  fetchUpdateAsync(): Promise<unknown>;
  reloadAsync(): Promise<void>;
}

export type UpdateCheckResult =
  { status: 'up-to-date' } | { status: 'restarting' } | { status: 'error'; error: string };

/** Checks for an update, downloads it and restarts the app if there is one. */
export async function checkAndApplyUpdate(api: UpdatesApi): Promise<UpdateCheckResult> {
  try {
    const { isAvailable } = await api.checkForUpdateAsync();
    if (!isAvailable) return { status: 'up-to-date' };
    await api.fetchUpdateAsync();
    await api.reloadAsync();
    return { status: 'restarting' };
  } catch (error) {
    return { status: 'error', error: error instanceof Error ? error.message : String(error) };
  }
}

export function describeUpdateCheck(result: UpdateCheckResult): string {
  switch (result.status) {
    case 'up-to-date':
      return 'Die App ist auf dem neuesten Stand.';
    case 'restarting':
      return 'Update geladen, die App startet neu …';
    case 'error':
      return `Suche fehlgeschlagen: ${result.error}`;
  }
}
