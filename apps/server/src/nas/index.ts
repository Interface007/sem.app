import type { Config } from '../config.js';
import { DsmNasGateway } from './dsm.js';
import type { NasGateway } from './gateway.js';
import { LocalNasGateway } from './local.js';

export type {
  NasCredentials,
  NasGateway,
  NasLoginFailure,
  NasLoginResult,
  NasSession,
} from './gateway.js';

/** Used when no NAS is configured: the server starts, but nobody can log in. */
export class UnconfiguredNasGateway implements NasGateway {
  login(): Promise<{ ok: false; reason: 'unavailable' }> {
    return Promise.resolve({ ok: false, reason: 'unavailable' });
  }

  logout(): Promise<void> {
    return Promise.resolve();
  }
}

export interface WarnLogger {
  warn(message: string): void;
}

export function createNasGateway(config: Pick<Config, 'nas'>, logger?: WarnLogger): NasGateway {
  switch (config.nas.kind) {
    case 'dsm':
      return new DsmNasGateway(config.nas.url);
    case 'local':
      logger?.warn('NAS_GATEWAY=local is for tests and development only, not for production use.');
      return new LocalNasGateway(config.nas.users);
    case 'none':
      return new UnconfiguredNasGateway();
  }
}
