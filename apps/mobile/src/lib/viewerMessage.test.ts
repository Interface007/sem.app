import { describe, expect, it } from 'vitest';
import { parseViewerMessage } from './viewerMessage';

const valid = { typ: 'haus-modell/entitaeten', entitaeten: ['sensor.wohnzimmer_temperatur'] };

describe('parseViewerMessage', () => {
  it('accepts a valid entities message', () => {
    expect(parseViewerMessage(valid)).toEqual(valid);
  });

  it('accepts the JSON text coming from the WebView', () => {
    expect(parseViewerMessage(JSON.stringify(valid))).toEqual(valid);
  });

  it('drops a wrong type', () => {
    expect(parseViewerMessage({ ...valid, typ: 'haus-modell/messwerte' })).toBeUndefined();
  });

  it('drops additional fields', () => {
    expect(parseViewerMessage({ ...valid, extra: 1 })).toBeUndefined();
  });

  it('drops broken JSON', () => {
    expect(parseViewerMessage('{"typ":')).toBeUndefined();
  });

  it('drops null, undefined and other values', () => {
    for (const value of [null, undefined, 42, 'null', [], { typ: valid.typ, entitaeten: [] }]) {
      expect(parseViewerMessage(value)).toBeUndefined();
    }
  });
});
