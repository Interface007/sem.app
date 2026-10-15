import { describe, expect, it } from 'vitest';
import { formatBuildInfo, readBuildInfo } from './buildInfo';

describe('formatBuildInfo', () => {
  it('formats version and commit', () => {
    expect(formatBuildInfo({ version: '0.1.0', commit: 'abc1234' })).toBe(
      'Version 0.1.0 (abc1234)',
    );
  });
});

describe('readBuildInfo', () => {
  it('reads version and commit from the Expo config', () => {
    expect(readBuildInfo({ version: '1.2.3', extra: { gitCommit: 'abc1234' } })).toEqual({
      version: '1.2.3',
      commit: 'abc1234',
    });
  });

  it('falls back to "unknown" for missing or malformed values', () => {
    const unknown = { version: 'unknown', commit: 'unknown' };
    expect(readBuildInfo(null)).toEqual(unknown);
    expect(readBuildInfo({ extra: { gitCommit: 42 } })).toEqual(unknown);
    expect(readBuildInfo({ version: '', extra: { gitCommit: '' } })).toEqual(unknown);
  });
});
