import type { LocationSharing } from './sharing';

/** Stops sharing and deletes the position while the token still exists, then signs out. */
export async function logoutStoppingSharing(
  sharing: Pick<LocationSharing, 'stopForLogout'>,
  logout: () => Promise<void>,
): Promise<void> {
  try {
    await sharing.stopForLogout();
  } catch {
    // Signing out must work even if the cleanup fails.
  }
  await logout();
}
