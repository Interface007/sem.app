import { describe, expect, it } from 'vitest';
import { DeviceId, FamilyLocation, LocationList, LocationReport } from './index.js';

const report = {
  deviceId: 'device-1234',
  deviceName: 'Pixel von Anna',
  latitude: 48.1,
  longitude: 11.5,
  accuracy: 12.5,
  recordedAt: '2026-01-01T10:00:00.000Z',
};

describe('LocationReport', () => {
  it.each([
    ['with accuracy', report],
    ['with null accuracy', { ...report, accuracy: null }],
    ['at the coordinate limits', { ...report, latitude: -90, longitude: 180 }],
  ])('accepts %s', (_name, value) => {
    expect(LocationReport.parse(value)).toEqual(value);
  });

  it.each([
    ['latitude 91', { ...report, latitude: 91 }],
    ['latitude -91', { ...report, latitude: -91 }],
    ['longitude 181', { ...report, longitude: 181 }],
    ['deviceId with a space', { ...report, deviceId: 'device 1234' }],
    ['deviceId too short', { ...report, deviceId: 'abc' }],
    ['deviceId too long', { ...report, deviceId: 'a'.repeat(65) }],
    ['empty deviceName', { ...report, deviceName: '' }],
    ['deviceName over 60 characters', { ...report, deviceName: 'x'.repeat(61) }],
    ['negative accuracy', { ...report, accuracy: -1 }],
    ['missing accuracy', { ...report, accuracy: undefined }],
    ['invalid recordedAt', { ...report, recordedAt: 'gestern' }],
    ['additional field user', { ...report, user: 'anna' }],
  ])('rejects %s', (_name, value) => {
    expect(LocationReport.safeParse(value).success).toBe(false);
  });
});

describe('DeviceId', () => {
  it('accepts 8 to 64 URL-safe characters', () => {
    expect(DeviceId.safeParse('a_B-9xyz').success).toBe(true);
    expect(DeviceId.safeParse('a'.repeat(64)).success).toBe(true);
  });
});

describe('FamilyLocation and LocationList', () => {
  const location = {
    user: 'anna',
    ...report,
    receivedAt: '2026-01-01T10:00:05.000Z',
  };

  it('accepts a list of locations', () => {
    expect(LocationList.parse({ locations: [location] })).toEqual({ locations: [location] });
    expect(LocationList.parse({ locations: [] })).toEqual({ locations: [] });
  });

  it('requires receivedAt and rejects unknown fields', () => {
    expect(FamilyLocation.safeParse({ ...report, user: 'anna' }).success).toBe(false);
    expect(FamilyLocation.safeParse({ ...location, extra: 1 }).success).toBe(false);
  });
});
