import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/** Times are milliseconds since the epoch. */
export interface StoredSession {
  id: string;
  user: string;
  /** DSM session id; never leaves the server. */
  sid: string;
  expiresAt: number;
  /** Last time `expiresAt` was written; limits write frequency. */
  extendedAt: number;
}

export interface NewSession {
  id: string;
  tokenHash: string;
  user: string;
  sid: string;
  now: number;
  expiresAt: number;
}

export interface SessionStore {
  create(session: NewSession): void;
  findByTokenHash(tokenHash: string): StoredSession | undefined;
  extend(id: string, now: number, expiresAt: number): void;
  delete(id: string): void;
  /** Removes all sessions that expired at or before `now`. */
  deleteExpired(now: number): void;
  /** Key for the house viewer route of a session; `undefined` until one is set. */
  getViewerKey(id: string): string | undefined;
  /** Sets the key unless the session already has one. */
  setViewerKey(id: string, key: string): void;
  findByViewerKey(key: string): { id: string; expiresAt: number } | undefined;
  close(): void;
}

const SCHEMA_VERSION = 2;

interface SessionRow {
  id: string;
  username: string;
  sid: string;
  expires_at: number;
  extended_at: number;
}

export class SqliteSessionStore implements SessionStore {
  private readonly db: DatabaseSync;

  /** `file` is a path or `:memory:`; parent folders of a path are created. */
  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.migrate();
  }

  private migrate(): void {
    const row = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
    if (row.user_version > SCHEMA_VERSION) {
      throw new Error(`Database schema version ${row.user_version} is newer than supported`);
    }
    if (row.user_version < 1) {
      this.db.exec(`
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY,
          token_hash TEXT NOT NULL UNIQUE,
          username TEXT NOT NULL,
          sid TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          extended_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL
        );
        CREATE INDEX sessions_expires_at ON sessions (expires_at);
      `);
    }
    if (row.user_version < 2) {
      this.db.exec(`
        ALTER TABLE sessions ADD COLUMN viewer_key TEXT;
        CREATE UNIQUE INDEX sessions_viewer_key ON sessions (viewer_key);
      `);
    }
    this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  }

  create(session: NewSession): void {
    this.db
      .prepare(
        `INSERT INTO sessions (id, token_hash, username, sid, created_at, extended_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        session.id,
        session.tokenHash,
        session.user,
        session.sid,
        session.now,
        session.now,
        session.expiresAt,
      );
  }

  findByTokenHash(tokenHash: string): StoredSession | undefined {
    const row = this.db
      .prepare(
        'SELECT id, username, sid, expires_at, extended_at FROM sessions WHERE token_hash = ?',
      )
      .get(tokenHash) as SessionRow | undefined;
    if (row === undefined) return undefined;
    return {
      id: row.id,
      user: row.username,
      sid: row.sid,
      expiresAt: row.expires_at,
      extendedAt: row.extended_at,
    };
  }

  extend(id: string, now: number, expiresAt: number): void {
    this.db
      .prepare('UPDATE sessions SET extended_at = ?, expires_at = ? WHERE id = ?')
      .run(now, expiresAt, id);
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  }

  deleteExpired(now: number): void {
    this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
  }

  getViewerKey(id: string): string | undefined {
    const row = this.db.prepare('SELECT viewer_key FROM sessions WHERE id = ?').get(id) as
      { viewer_key: string | null } | undefined;
    return row?.viewer_key ?? undefined;
  }

  setViewerKey(id: string, key: string): void {
    this.db
      .prepare('UPDATE sessions SET viewer_key = ? WHERE id = ? AND viewer_key IS NULL')
      .run(key, id);
  }

  findByViewerKey(key: string): { id: string; expiresAt: number } | undefined {
    const row = this.db
      .prepare('SELECT id, expires_at FROM sessions WHERE viewer_key = ?')
      .get(key) as { id: string; expires_at: number } | undefined;
    return row === undefined ? undefined : { id: row.id, expiresAt: row.expires_at };
  }

  close(): void {
    if (this.db.isOpen) this.db.close();
  }
}

/** File `sem.db` in `dataDir`, or an in-memory database if it is unset. */
export function openSessionStore(
  dataDir: string | undefined,
  logger?: { warn(message: string): void },
): SessionStore {
  if (dataDir === undefined) {
    logger?.warn('DATA_DIR is not set: sessions are kept in memory and lost on restart.');
    return new SqliteSessionStore(':memory:');
  }
  return new SqliteSessionStore(path.join(dataDir, 'sem.db'));
}
