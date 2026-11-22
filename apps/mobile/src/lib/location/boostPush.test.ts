import { BOOST_INTERVAL_MS } from '@sem/contracts';
import { describe, expect, it } from 'vitest';
import { boostFromPushPayload } from './boostPush';
import { BOOST_LOCATION_INTERVAL_MS, LOCATION_INTERVALS_MS } from './constants';

const until = '2026-01-01T12:10:00.000Z';

describe('boostFromPushPayload', () => {
  it('reads the boost from plain data fields', () => {
    expect(
      boostFromPushPayload({
        notification: null,
        data: { type: 'location-boost', boostUntil: until },
      }),
    ).toBe(Date.parse(until));
  });

  it('reads the boost from dataString', () => {
    const dataString = JSON.stringify({ type: 'location-boost', boostUntil: until });
    expect(boostFromPushPayload({ notification: null, data: { dataString } })).toBe(
      Date.parse(until),
    );
  });

  it.each([
    ['nothing', undefined],
    ['a notification response', { actionIdentifier: 'x', notification: {} }],
    ['another message type', { data: { type: 'other', boostUntil: until } }],
    ['an invalid time', { data: { type: 'location-boost', boostUntil: 'bald' } }],
    ['broken JSON', { data: { dataString: '{' } }],
  ])('ignores %s', (_name, payload) => {
    expect(boostFromPushPayload(payload)).toBeUndefined();
  });
});

describe('boost interval', () => {
  it('matches the contract and is a selectable interval', () => {
    expect(BOOST_LOCATION_INTERVAL_MS).toBe(BOOST_INTERVAL_MS);
    expect(LOCATION_INTERVALS_MS).toContain(BOOST_LOCATION_INTERVAL_MS);
  });
});
