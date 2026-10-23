import { describe, expect, it, vi } from 'vitest';
import {
  checkAndApplyUpdate,
  describeRunningUpdate,
  describeUpdateCheck,
  type UpdatesApi,
} from './updateStatus';

const id = '0b1f6c0e-5d0e-4c53-9a34-0d3f1d1f9a11';

function api(overrides: Partial<UpdatesApi> = {}): UpdatesApi {
  return {
    checkForUpdateAsync: vi.fn().mockResolvedValue({ isAvailable: true }),
    fetchUpdateAsync: vi.fn().mockResolvedValue({}),
    reloadAsync: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('describeRunningUpdate', () => {
  it('shows the update ID of a downloaded update', () => {
    expect(describeRunningUpdate({ isEnabled: true, isEmbeddedLaunch: false, updateId: id })).toBe(
      id,
    );
  });

  it('shows "eingebettet" for the embedded bundle', () => {
    expect(describeRunningUpdate({ isEnabled: true, isEmbeddedLaunch: true, updateId: id })).toBe(
      'eingebettet',
    );
    expect(
      describeRunningUpdate({ isEnabled: true, isEmbeddedLaunch: false, updateId: null }),
    ).toBe('eingebettet');
  });

  it('says so when updates are disabled', () => {
    expect(
      describeRunningUpdate({ isEnabled: false, isEmbeddedLaunch: true, updateId: null }),
    ).toBe('Updates nicht verfügbar');
  });
});

describe('checkAndApplyUpdate', () => {
  it('downloads and restarts when an update is available', async () => {
    const updates = api();
    expect(await checkAndApplyUpdate(updates)).toEqual({ status: 'restarting' });
    expect(updates.fetchUpdateAsync).toHaveBeenCalledOnce();
    expect(updates.reloadAsync).toHaveBeenCalledOnce();
  });

  it('does nothing when no update is available', async () => {
    const updates = api({ checkForUpdateAsync: vi.fn().mockResolvedValue({ isAvailable: false }) });
    expect(await checkAndApplyUpdate(updates)).toEqual({ status: 'up-to-date' });
    expect(updates.fetchUpdateAsync).not.toHaveBeenCalled();
    expect(updates.reloadAsync).not.toHaveBeenCalled();
  });

  it('reports errors without restarting', async () => {
    const updates = api({ fetchUpdateAsync: vi.fn().mockRejectedValue(new Error('offline')) });
    expect(await checkAndApplyUpdate(updates)).toEqual({ status: 'error', error: 'offline' });
    expect(updates.reloadAsync).not.toHaveBeenCalled();
  });
});

describe('describeUpdateCheck', () => {
  it('words every result in German', () => {
    expect(describeUpdateCheck({ status: 'up-to-date' })).toContain('neuesten Stand');
    expect(describeUpdateCheck({ status: 'restarting' })).toContain('neu');
    expect(describeUpdateCheck({ status: 'error', error: 'offline' })).toContain('offline');
  });
});
