import { describe, expect, it } from 'vitest';
import { parseServerUrls, serverHost } from './serverUrls';

describe('parseServerUrls', () => {
  it('trims, strips trailing slashes and removes duplicates', () => {
    expect(parseServerUrls(' https://a.example/ , https://b.example// ,https://a.example')).toEqual(
      ['https://a.example', 'https://b.example'],
    );
  });

  it('drops plain HTTP except for local development hosts', () => {
    expect(
      parseServerUrls(
        'http://nas.example,http://localhost:8080,http://127.0.0.1,http://10.0.2.2:3000',
      ),
    ).toEqual(['http://localhost:8080', 'http://127.0.0.1', 'http://10.0.2.2:3000']);
  });

  it('drops entries that are not URLs', () => {
    expect(parseServerUrls('nas.example,ftp://a.example,https://ok.example')).toEqual([
      'https://ok.example',
    ]);
  });

  it('returns an empty list for an empty value', () => {
    expect(parseServerUrls('')).toEqual([]);
    expect(parseServerUrls(' , ')).toEqual([]);
  });
});

describe('serverHost', () => {
  it('returns only the host name', () => {
    expect(serverHost('https://nas.tail1.ts.net')).toBe('nas.tail1.ts.net');
    expect(serverHost('http://localhost:8080')).toBe('localhost');
  });

  it('is empty for the same origin', () => {
    expect(serverHost('')).toBe('');
  });
});
