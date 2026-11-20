import type { DatabaseSync } from 'node:sqlite';
import type { LocationPersistence, StoredLocation } from './store.js';

interface LocationRow {
  username: string;
  device_id: string;
  device_name: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  recorded_at: number;
  received_at: number;
}

/** Table `locations`; the schema is created by the migration in `db/sessions.ts`. */
export class SqliteLocationPersistence implements LocationPersistence {
  constructor(private readonly db: DatabaseSync) {}

  load(): StoredLocation[] {
    const rows = this.db.prepare('SELECT * FROM locations').all() as unknown as LocationRow[];
    return rows.map((row) => ({
      user: row.username,
      deviceId: row.device_id,
      deviceName: row.device_name,
      latitude: row.latitude,
      longitude: row.longitude,
      accuracy: row.accuracy,
      recordedAt: row.recorded_at,
      receivedAt: row.received_at,
    }));
  }

  replaceAll(locations: readonly StoredLocation[]): void {
    const insert = this.db.prepare(
      `INSERT INTO locations
         (username, device_id, device_name, latitude, longitude, accuracy, recorded_at, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.db.exec('BEGIN');
    try {
      this.db.exec('DELETE FROM locations');
      for (const l of locations) {
        insert.run(
          l.user,
          l.deviceId,
          l.deviceName,
          l.latitude,
          l.longitude,
          l.accuracy,
          l.recordedAt,
          l.receivedAt,
        );
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}
