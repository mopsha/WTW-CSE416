import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { queries } from '@/lib/queries';

import { useAuth } from './useAuth';

interface ProfileState {
  /** My profiles.display_name; null if it isn't set or couldn't be read. */
  displayName: string | null;
}

const ProfileContext = createContext<ProfileState>({ displayName: null });

/** Reads my profile once per signed-in user (not on every token refresh). */
export function ProfileProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const [state, setState] = useState<{ userId: string | null; displayName: string | null }>({
    userId: null,
    displayName: null,
  });

  useEffect(() => {
    if (!userId) return;
    let active = true;
    // A failed read just leaves the email-derived name in place.
    queries
      .getMyProfile(userId)
      .then((profile) => active && setState({ userId, displayName: profile.displayName }))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [userId]);

  const value = { displayName: state.userId === userId ? state.displayName : null };
  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile(): ProfileState {
  return useContext(ProfileContext);
}
