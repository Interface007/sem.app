import { describe, expect, it } from 'vitest';
import { ApiError, LoginRequest, LoginResponse, SessionResponse } from './index.js';

const login = { username: 'anna', password: 'geheim', tokenDelivery: 'body' };

describe('LoginRequest', () => {
  it('accepts a request without OTP', () => {
    expect(LoginRequest.parse(login)).toEqual(login);
  });

  it('accepts a six digit OTP and trims the username', () => {
    expect(LoginRequest.parse({ ...login, username: '  anna ', otp: '012345' })).toEqual({
      ...login,
      otp: '012345',
    });
  });

  it.each([
    ['OTP with 5 digits', { ...login, otp: '12345' }],
    ['OTP with letters', { ...login, otp: '12345a' }],
    ['unknown field', { ...login, extra: 1 }],
    ['empty password', { ...login, password: '' }],
    ['blank username', { ...login, username: '   ' }],
    ['username over 64 characters', { ...login, username: 'a'.repeat(65) }],
    ['password over 256 characters', { ...login, password: 'a'.repeat(257) }],
    ['missing tokenDelivery', { username: 'anna', password: 'geheim' }],
    ['unknown tokenDelivery', { ...login, tokenDelivery: 'header' }],
  ])('rejects %s', (_name, value) => {
    expect(LoginRequest.safeParse(value).success).toBe(false);
  });
});

describe('LoginResponse and SessionResponse', () => {
  const session = { user: { name: 'anna' }, expiresAt: '2026-12-17T10:00:00.000Z' };

  it('accepts a response with and without token', () => {
    expect(LoginResponse.parse({ ...session, token: 'abc' })).toEqual({ ...session, token: 'abc' });
    expect(LoginResponse.parse(session)).toEqual(session);
    expect(SessionResponse.parse(session)).toEqual(session);
  });

  it('rejects a token on a session response and invalid dates', () => {
    expect(SessionResponse.safeParse({ ...session, token: 'abc' }).success).toBe(false);
    expect(SessionResponse.safeParse({ ...session, expiresAt: 'morgen' }).success).toBe(false);
  });
});

describe('ApiError', () => {
  it('accepts a known code', () => {
    const value = { error: 'unauthenticated', message: 'Bitte anmelden.' };
    expect(ApiError.parse(value)).toEqual(value);
  });

  it.each([
    ['unknown code', { error: 'boom', message: 'x' }],
    ['empty message', { error: 'unauthenticated', message: '' }],
    ['unknown field', { error: 'unauthenticated', message: 'x', extra: 1 }],
  ])('rejects %s', (_name, value) => {
    expect(ApiError.safeParse(value).success).toBe(false);
  });
});
