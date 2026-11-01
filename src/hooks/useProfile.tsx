import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

import { api } from '@/lib/api';
import { queries } from '@/lib/queries';

import { useAuth } from './useAuth';

interface ProfileState {
  /** My display name; null until I've picked one ("what should we call you?"). */
  displayName: string | null;
  /** True while the signed-in user's profile is being read. */
  loading: boolean;
  /** True when the read failed; the app then skips the name step instead of blocking. */
  failed: boolean;
  /** Saves through POST /me and updates everyone reading this context. */
  saveDisplayName(name: string): Promise<void>;
}

const ProfileContext = createContext<ProfileState>({
  displayName: null,
  loading: false,
  failed: false,
  saveDisplayName: async () => {},
});

/** Reads my profile once per signed-in user (not on every token refresh). */
export function ProfileProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const [state, setState] = useState({
    userId: null as string | null,
    displayName: null as string | null,
    failed: false,
  });

  useEffect(() => {
    if (!userId) return;
    let active = true;
    // Like useAuth: an unreachable backend must not leave the app on a blank screen.
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), 4000),
    );
    Promise.race([queries.getMyProfile(userId), timeout])
      .then(
        (profile) =>
          active && setState({ userId, displayName: profile.displayName, failed: false }),
      )
      .catch(() => active && setState({ userId, displayName: null, failed: true }));
    return () => {
      active = false;
    };
  }, [userId]);

  const saveDisplayName = useCallback(
    async (name: string) => {
      const { displayName } = await api.updateMe(name);
      setState({ userId, displayName, failed: false });
    },
    [userId],
  );

  const current = state.userId === userId;
  const value: ProfileState = {
    displayName: current ? state.displayName : null,
    loading: !!userId && !current,
    failed: current && state.failed,
    saveDisplayName,
  };
  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile(): ProfileState {
  return useContext(ProfileContext);
}

/** A starting suggestion for the name step: the email's local part, up to 50 characters. */
export function suggestedName(email: string | null): string {
  return [...(email?.split('@')[0]?.trim() ?? '')].slice(0, 50).join('');
}
