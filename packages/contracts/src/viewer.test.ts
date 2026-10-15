import { describe, expect, it } from 'vitest';
import { ViewerEntitiesMessage, ViewerReadingsMessage } from './index.js';

describe('ViewerEntitiesMessage', () => {
  it('accepts the announcement the viewer sends', () => {
    const message = {
      typ: 'haus-modell/entitaeten',
      entitaeten: ['sensor.wohnzimmer_temperatur', 'binary_sensor.fenster_kueche'],
    };
    expect(ViewerEntitiesMessage.parse(message)).toEqual(message);
  });

  it.each([
    ['wrong typ', { typ: 'haus-modell/messwerte', entitaeten: ['sensor.x'] }],
    ['empty list', { typ: 'haus-modell/entitaeten', entitaeten: [] }],
    ['entity without domain', { typ: 'haus-modell/entitaeten', entitaeten: ['wohnzimmer'] }],
    ['non-string entity', { typ: 'haus-modell/entitaeten', entitaeten: [42] }],
    [
      'entity id too long',
      { typ: 'haus-modell/entitaeten', entitaeten: [`sensor.${'a'.repeat(120)}`] },
    ],
    ['missing list', { typ: 'haus-modell/entitaeten' }],
  ])('rejects %s', (_name, message) => {
    expect(ViewerEntitiesMessage.safeParse(message).success).toBe(false);
  });
});

describe('ViewerReadingsMessage', () => {
  it('accepts readings in the format of haus-modell-card.js', () => {
    const message = {
      typ: 'haus-modell/messwerte',
      werte: {
        'sensor.wohnzimmer_temperatur': { wert: '21.5', einheit: '°C', alter: 42 },
        'binary_sensor.fenster_kueche': { wert: 'off', einheit: '', alter: null },
      },
    };
    expect(ViewerReadingsMessage.parse(message)).toEqual(message);
  });

  it('accepts an empty set of readings', () => {
    expect(
      ViewerReadingsMessage.safeParse({ typ: 'haus-modell/messwerte', werte: {} }).success,
    ).toBe(true);
  });

  const reading = { wert: '21.5', einheit: '°C', alter: 42 };
  it.each([
    ['wrong typ', { typ: 'haus-modell/entitaeten', werte: { 'sensor.x': reading } }],
    [
      'numeric wert',
      { typ: 'haus-modell/messwerte', werte: { 'sensor.x': { ...reading, wert: 21.5 } } },
    ],
    [
      'missing einheit',
      { typ: 'haus-modell/messwerte', werte: { 'sensor.x': { wert: '1', alter: 1 } } },
    ],
    [
      'negative alter',
      { typ: 'haus-modell/messwerte', werte: { 'sensor.x': { ...reading, alter: -1 } } },
    ],
    [
      'fractional alter',
      { typ: 'haus-modell/messwerte', werte: { 'sensor.x': { ...reading, alter: 1.5 } } },
    ],
    ['invalid entity key', { typ: 'haus-modell/messwerte', werte: { 'kein sensor': reading } }],
    ['werte as array', { typ: 'haus-modell/messwerte', werte: [reading] }],
  ])('rejects %s', (_name, message) => {
    expect(ViewerReadingsMessage.safeParse(message).success).toBe(false);
  });
});
