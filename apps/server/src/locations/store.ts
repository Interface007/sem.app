/** Times are milliseconds since the epoch. */
export interface StoredLocation {
  user: string;
  deviceId: string;
  deviceName: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  recordedAt: number;
  receivedAt: number;
  /** FCM token of the device; never sent to other clients. */
  pushToken: string | null;
}

export interface LocationReading {
  deviceName: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  recordedAt: number;
  /** `undefined` keeps the stored token (report from an app that does not send one). */
  pushToken?: string | null;
}

/** Where the latest positions survive a restart. */
export interface LocationPersistence {
  load(): StoredLocation[];
  /** Replaces the persisted state with `locations` in one transaction. */
  replaceAll(locations: readonly StoredLocation[]): void;
}

/** Latest position per (user, device); the single source of truth for the routes. */
export interface LocationStore {
  /**
   * Stores the reading unless the device already has a newer one.
   * Returns whether it was stored.
   */
  report(user: string, deviceId: string, reading: LocationReading): boolean;
  /** All positions that are not older than the retention limit, sorted by user, then device name. */
  list(): StoredLocation[];
  has(user: string, deviceId: string): boolean;
  /** All current entries with this device id (normally one). */
  findByDevice(deviceId: string): StoredLocation[];
  /** Forgets the token, e.g. after FCM reported it as no longer registered. */
  clearPushToken(user: string, deviceId: string, token: string): void;
  /** Whether a user other than `user` has a position for this device id. */
  hasOtherUser(user: string, deviceId: string): boolean;
  remove(user: string, deviceId: string): void;
  /** Drops expired entries and writes pending changes; called periodically. */
  tick(): void;
  /** Writes pending changes. */
  flush(): void;
  /** Writes pending changes; the store must not be used afterwards. */
  close(): void;
}

export interface LocationStoreOptions {
  persistence: LocationPersistence | undefined;
  now: () => number;
  maxAgeMs: number;
}

function key(user: string, deviceId: string): string {
  return `${user}\u0000${deviceId}`;
}

function compare(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

/** Keeps the positions in memory and writes them to the persistence only on `flush`. */
export class MemoryLocationStore implements LocationStore {
  private readonly entries = new Map<string, StoredLocation>();
  private dirty = false;

  constructor(private readonly options: LocationStoreOptions) {
    for (const row of options.persistence?.load() ?? []) {
      this.entries.set(key(row.user, row.deviceId), row);
    }
    this.purge();
  }

  private purge(): void {
    const limit = this.options.now() - this.options.maxAgeMs;
    for (const [id, entry] of this.entries) {
      if (entry.receivedAt <= limit) {
        this.entries.delete(id);
        this.dirty = true;
      }
    }
  }

  report(user: string, deviceId: string, reading: LocationReading): boolean {
    this.purge();
    const id = key(user, deviceId);
    const existing = this.entries.get(id);
    if (existing !== undefined && reading.recordedAt < existing.recordedAt) return false;
    const { pushToken, ...rest } = reading;
    this.entries.set(id, {
      user,
      deviceId,
      ...rest,
      receivedAt: this.options.now(),
      pushToken: pushToken === undefined ? (existing?.pushToken ?? null) : pushToken,
    });
    this.dirty = true;
    return true;
  }

  list(): StoredLocation[] {
    this.purge();
    return [...this.entries.values()].sort(
      (a, b) => compare(a.user, b.user) || compare(a.deviceName, b.deviceName),
    );
  }

  has(user: string, deviceId: string): boolean {
    this.purge();
    return this.entries.has(key(user, deviceId));
  }

  findByDevice(deviceId: string): StoredLocation[] {
    this.purge();
    return [...this.entries.values()].filter((entry) => entry.deviceId === deviceId);
  }

  clearPushToken(user: string, deviceId: string, token: string): void {
    const entry = this.entries.get(key(user, deviceId));
    if (entry === undefined || entry.pushToken !== token) return;
    entry.pushToken = null;
    this.dirty = true;
  }

  hasOtherUser(user: string, deviceId: string): boolean {
    this.purge();
    for (const entry of this.entries.values()) {
      if (entry.deviceId === deviceId && entry.user !== user) return true;
    }
    return false;
  }

  remove(user: string, deviceId: string): void {
    if (this.entries.delete(key(user, deviceId))) this.dirty = true;
  }

  tick(): void {
    this.purge();
    this.flush();
  }

  flush(): void {
    if (!this.dirty) return;
    this.options.persistence?.replaceAll([...this.entries.values()]);
    this.dirty = false;
  }

  close(): void {
    this.tick();
  }
}
