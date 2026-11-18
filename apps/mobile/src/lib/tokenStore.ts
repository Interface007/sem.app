import * as SecureStore from 'expo-secure-store';
import type { TokenStore } from './session';

const KEY = 'sem_session_token';

/** Android: the session token lives in the Keystore-backed secure store. */
export const tokenStore: TokenStore = {
  get: () => SecureStore.getItemAsync(KEY),
  set: (token) => SecureStore.setItemAsync(KEY, token),
  clear: () => SecureStore.deleteItemAsync(KEY),
};

/** The token is returned in the response body and sent as a bearer token. */
export const tokenDelivery = 'body' as const;
