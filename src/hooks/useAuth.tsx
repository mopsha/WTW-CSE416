import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { auth, type AuthSession } from '@/lib/auth';

interface AuthState {
  session: AuthSession | null;
  /** True until the stored session (if any) has been read. */
  loading: boolean;
}

const AuthContext = createContext<AuthState>({ session: null, loading: true });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ session: null, loading: true });

  useEffect(() => {
    let active = true;
    let unsubscribe = () => {};
    // If the backend is unreachable, refreshing a stored session can hang for a long time.
    // Don't sit on a blank screen: after 4 s treat it as signed out (the listener below
    // still updates us if the session resolves later).
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000));
    Promise.race([auth.getSession(), timeout])
      .then((session) => active && setState({ session, loading: false }))
      // Misconfigured env (no Supabase URL): fall through to sign-in, which shows the error.
      .catch(() => active && setState({ session: null, loading: false }));
    try {
      unsubscribe = auth.onChange((session) => setState({ session, loading: false }));
    } catch {
      // Same as above: no client to subscribe to.
    }
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}

/** For screens behind the auth guard, where a session always exists. */
export function useSession(): AuthSession {
  const { session } = useAuth();
  if (!session) throw new Error('useSession() used outside the signed-in stack.');
  return session;
}
