import { DeviceId } from '@sem/contracts';

export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export interface SharingSettings {
  isEnabled(): Promise<boolean>;
  setEnabled(enabled: boolean): Promise<void>;
  /** Epoch milliseconds of the last accepted report, `null` if none yet. */
  getLastSentAt(): Promise<number | null>;
  setLastSentAt(at: number): Promise<void>;
  /** True if sharing was switched off because restarting it failed; cleared by the next enable. */
  wasStoppedByError(): Promise<boolean>;
  setStoppedByError(stopped: boolean): Promise<void>;
  /** Random id of this installation; created once, then stable. */
  getDeviceId(): Promise<DeviceId>;
}

const ENABLED_KEY = 'sem_location_sharing';
const LAST_SENT_KEY = 'sem_location_last_sent';
const STOPPED_BY_ERROR_KEY = 'sem_location_stopped_by_error';
const DEVICE_ID_KEY = 'sem_device_id';

export function createSharingSettings(
  store: KeyValueStore,
  randomUuid: () => string,
): SharingSettings {
  return {
    async isEnabled() {
      return (await store.get(ENABLED_KEY)) === 'true';
    },
    setEnabled: (enabled) => store.set(ENABLED_KEY, enabled ? 'true' : 'false'),
    async getLastSentAt() {
      const value = Number(await store.get(LAST_SENT_KEY));
      return Number.isFinite(value) && value > 0 ? value : null;
    },
    setLastSentAt: (at) => store.set(LAST_SENT_KEY, String(at)),
    async wasStoppedByError() {
      return (await store.get(STOPPED_BY_ERROR_KEY)) === 'true';
    },
    setStoppedByError: (stopped) => store.set(STOPPED_BY_ERROR_KEY, stopped ? 'true' : 'false'),
    async getDeviceId() {
      const stored = DeviceId.safeParse(await store.get(DEVICE_ID_KEY));
      if (stored.success) return stored.data;
      const created = DeviceId.parse(randomUuid());
      await store.set(DEVICE_ID_KEY, created);
      return created;
    },
  };
}

/** Version 4 UUID from `crypto.randomUUID`, with a fallback for runtimes without it. */
export function randomUuid(): string {
  const webCrypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (webCrypto?.randomUUID) return webCrypto.randomUUID();
  // The id is an identifier, not a secret, so Math.random is sufficient here.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
