import { describe, expect, it } from 'vitest';
import { Health } from './index.js';

describe('Health', () => {
  it('accepts a complete ok response', () => {
    const value = { status: 'ok', version: '0.1.0', commit: 'abc1234' };
    expect(Health.parse(value)).toEqual(value);
  });

  it.each([
    ['another status', { status: 'down', version: '0.1.0', commit: 'abc1234' }],
    ['missing commit', { status: 'ok', version: '0.1.0' }],
    ['empty version', { status: 'ok', version: '', commit: 'abc1234' }],
    ['unknown key', { status: 'ok', version: '0.1.0', commit: 'abc1234', extra: 1 }],
  ])('rejects %s', (_name, value) => {
    expect(Health.safeParse(value).success).toBe(false);
  });
});
