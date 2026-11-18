import type { TokenStore } from './session';

/**
 * Web: the token is an HttpOnly cookie that JavaScript never sees, so there is
 * nothing to store (and nothing in `localStorage`).
 */
export const tokenStore: TokenStore = {
  get: async () => null,
  set: async () => undefined,
  clear: async () => undefined,
};

export const tokenDelivery = 'cookie' as const;
