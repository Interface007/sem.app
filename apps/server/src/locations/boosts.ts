/** Active boosts by device id; kept in memory only, since a boost lasts minutes. */
export class BoostRegistry {
  private readonly until = new Map<string, number>();

  constructor(private readonly now: () => number) {}

  set(deviceId: string, until: number): void {
    this.until.set(deviceId, until);
  }

  /** End of the active boost, `undefined` if the device has none (expired ones are dropped). */
  get(deviceId: string): number | undefined {
    const until = this.until.get(deviceId);
    if (until === undefined) return undefined;
    if (until > this.now()) return until;
    this.until.delete(deviceId);
    return undefined;
  }

  delete(deviceId: string): void {
    this.until.delete(deviceId);
  }

  /** All active boosts, sorted by device id. */
  list(): { deviceId: string; until: number }[] {
    const result: { deviceId: string; until: number }[] = [];
    for (const deviceId of [...this.until.keys()].sort()) {
      const until = this.get(deviceId);
      if (until !== undefined) result.push({ deviceId, until });
    }
    return result;
  }
}
