import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { SessionStore } from '../db/sessions.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** `expiresAt` is written at most this often per session. */
const EXTEND_INTERVAL_MS = 60 * 60 * 1000;

export interface Session {
  id: string;
  user: string;
  /** Milliseconds since the epoch. */
  expiresAt: number;
}

export interface CreatedSession extends Session {
  token: string;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Sliding app sessions on top of a `SessionStore`; only token hashes are stored. */
export class SessionService {
  readonly ttlMs: number;

  constructor(
    private readonly store: SessionStore,
    private readonly now: () => number,
    ttlDays: number,
  ) {
    this.ttlMs = ttlDays * DAY_MS;
  }

  create(user: string, sid: string): CreatedSession {
    const token = randomBytes(32).toString('base64url');
    const id = randomUUID();
    const now = this.now();
    const expiresAt = now + this.ttlMs;
    this.store.create({ id, tokenHash: hashToken(token), user, sid, now, expiresAt });
    return { id, user, expiresAt, token };
  }

  /** Returns the session for a token, extending it; `undefined` if unknown or expired. */
  authenticate(token: string): (Session & { sid: string }) | undefined {
    const stored = this.store.findByTokenHash(hashToken(token));
    if (stored === undefined) return undefined;
    const now = this.now();
    if (stored.expiresAt <= now) {
      this.store.delete(stored.id);
      return undefined;
    }
    let { expiresAt } = stored;
    if (now - stored.extendedAt >= EXTEND_INTERVAL_MS) {
      expiresAt = now + this.ttlMs;
      this.store.extend(stored.id, now, expiresAt);
    }
    return { id: stored.id, user: stored.user, sid: stored.sid, expiresAt };
  }

  /**
   * The key for the house viewer path of a session. Random, stable for the
   * lifetime of the session, and not the session token.
   */
  viewerKey(id: string): string {
    const existing = this.store.getViewerKey(id);
    if (existing !== undefined) return existing;
    this.store.setViewerKey(id, randomBytes(32).toString('base64url'));
    const key = this.store.getViewerKey(id);
    if (key === undefined) throw new Error('session vanished');
    return key;
  }

  /** Whether the key belongs to a live session; does not extend the session. */
  isValidViewerKey(key: string): boolean {
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(key)) return false;
    const found = this.store.findByViewerKey(key);
    if (found === undefined) return false;
    if (found.expiresAt <= this.now()) {
      this.store.delete(found.id);
      return false;
    }
    return true;
  }

  revoke(id: string): void {
    this.store.delete(id);
  }

  deleteExpired(): void {
    this.store.deleteExpired(this.now());
  }
}
