import type { User } from '@sem/contracts';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Platform } from 'react-native';
import { locationSharing } from './location/adapter';
import { logoutStoppingSharing } from './location/logout';
import type { LoginResult } from './session';
import { session } from './sessionClient';

export type AuthState =
  | { status: 'checking' }
  | { status: 'signedOut' }
  | { status: 'signedIn'; user: User }
  | { status: 'unreachable' };

interface AuthContextValue {
  state: AuthState;
  login(input: { username: string; password: string; otp?: string }): Promise<LoginResult>;
  logout(): Promise<void>;
  /** Checks the session again, e.g. after "server unreachable". */
  retry(): void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'checking' });

  const check = useCallback(async () => {
    setState({ status: 'checking' });
    const result = await session.restore();
    setState(
      result.kind === 'signedIn'
        ? { status: 'signedIn', user: result.user }
        : { status: result.kind },
    );
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  useEffect(() => session.onUnauthenticated(() => setState({ status: 'signedOut' })), []);

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      async login(input) {
        const result = await session.login(input);
        if (result.kind === 'success') setState({ status: 'signedIn', user: result.user });
        return result;
      },
      async logout() {
        // Android: stop sharing and delete the position while the token still exists.
        if (Platform.OS === 'android') {
          await logoutStoppingSharing(locationSharing, () => session.logout());
        } else {
          await session.logout();
        }
        setState({ status: 'signedOut' });
      },
      retry() {
        void check();
      },
    }),
    [state, check],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (value === undefined) throw new Error('useAuth requires an AuthProvider');
  return value;
}
