import { apiFetch } from './apiFetch';
import { createSessionClient } from './session';
import { tokenDelivery, tokenStore } from './tokenStore';

/** The app-wide session client (platform token store, central `apiFetch`). */
export const session = createSessionClient({
  fetchApi: apiFetch,
  store: tokenStore,
  delivery: tokenDelivery,
});
