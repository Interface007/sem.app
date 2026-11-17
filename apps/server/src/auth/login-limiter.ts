const MAX_FAILURES = 5;
const WINDOW_MS = 10 * 60 * 1000;
const SWEEP_THRESHOLD = 1000;

/** Failed logins per user name within a sliding window; kept in memory. */
export class LoginLimiter {
  private readonly failures = new Map<string, number[]>();

  constructor(private readonly now: () => number) {}

  /** Seconds until another attempt is allowed, or `undefined` if allowed now. */
  retryAfterSeconds(key: string): number | undefined {
    const recent = this.recent(key);
    const oldest = recent[0];
    if (recent.length < MAX_FAILURES || oldest === undefined) return undefined;
    return Math.max(1, Math.ceil((oldest + WINDOW_MS - this.now()) / 1000));
  }

  recordFailure(key: string): void {
    if (this.failures.size >= SWEEP_THRESHOLD) this.sweep();
    this.failures.set(key, [...this.recent(key), this.now()]);
  }

  reset(key: string): void {
    this.failures.delete(key);
  }

  private recent(key: string): number[] {
    const cutoff = this.now() - WINDOW_MS;
    return (this.failures.get(key) ?? []).filter((time) => time > cutoff);
  }

  private sweep(): void {
    for (const key of [...this.failures.keys()]) {
      const recent = this.recent(key);
      if (recent.length === 0) this.failures.delete(key);
      else this.failures.set(key, recent);
    }
  }
}
