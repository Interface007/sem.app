import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config.js';
import { createNasGateway, UnconfiguredNasGateway } from './index.js';
import { DsmNasGateway } from './dsm.js';
import { LocalNasGateway } from './local.js';

const gateway = new LocalNasGateway([
  { account: 'Anna', password: 'pw' },
  { account: 'bob', password: 'pw2', otpCode: '123456' },
]);

describe('LocalNasGateway', () => {
  it('logs in and returns a random sid', async () => {
    const first = await gateway.login({ account: 'Anna', password: 'pw' });
    const second = await gateway.login({ account: 'Anna', password: 'pw' });
    expect(first).toMatchObject({ ok: true, session: { account: 'Anna' } });
    expect(first.ok && second.ok && first.session.sid !== second.session.sid).toBe(true);
  });

  it('ignores the case of the account name', async () => {
    expect(await gateway.login({ account: 'ANNA', password: 'pw' })).toMatchObject({ ok: true });
  });

  it('rejects a wrong password and unknown accounts', async () => {
    expect(await gateway.login({ account: 'anna', password: 'nope' })).toEqual({
      ok: false,
      reason: 'invalid_credentials',
    });
    expect(await gateway.login({ account: 'eve', password: 'pw' })).toEqual({
      ok: false,
      reason: 'invalid_credentials',
    });
  });

  it('asks for the OTP code, and rejects a wrong one', async () => {
    expect(await gateway.login({ account: 'bob', password: 'pw2' })).toEqual({
      ok: false,
      reason: 'otp_required',
    });
    expect(await gateway.login({ account: 'bob', password: 'pw2', otpCode: '000000' })).toEqual({
      ok: false,
      reason: 'otp_invalid',
    });
    expect(
      await gateway.login({ account: 'bob', password: 'pw2', otpCode: '123456' }),
    ).toMatchObject({
      ok: true,
    });
  });

  it('does not reveal the OTP requirement for a wrong password', async () => {
    expect(await gateway.login({ account: 'bob', password: 'wrong' })).toEqual({
      ok: false,
      reason: 'invalid_credentials',
    });
  });

  it('logs out without throwing', async () => {
    await expect(gateway.logout({ account: 'Anna', sid: 'x' })).resolves.toBeUndefined();
  });
});

describe('createNasGateway', () => {
  it('returns a gateway whose login is unavailable without configuration', async () => {
    const created = createNasGateway(loadConfig({}));
    expect(created).toBeInstanceOf(UnconfiguredNasGateway);
    expect(await created.login({ account: 'a', password: 'b' })).toEqual({
      ok: false,
      reason: 'unavailable',
    });
    await expect(created.logout({ account: 'a', sid: 's' })).resolves.toBeUndefined();
  });

  it('creates the DSM gateway', () => {
    const config = loadConfig({ NAS_GATEWAY: 'dsm', DSM_URL: 'http://127.0.0.1:5000' });
    expect(createNasGateway(config)).toBeInstanceOf(DsmNasGateway);
  });

  it('creates the local gateway and warns without printing passwords', async () => {
    const logger = { warn: vi.fn() };
    const config = loadConfig({ NAS_GATEWAY: 'local', LOCAL_USERS: 'anna:topsecret' });
    const created = createNasGateway(config, logger);
    expect(created).toBeInstanceOf(LocalNasGateway);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(String(logger.warn.mock.calls[0]?.[0])).not.toContain('topsecret');
    expect(await created.login({ account: 'anna', password: 'topsecret' })).toMatchObject({
      ok: true,
    });
  });
});
