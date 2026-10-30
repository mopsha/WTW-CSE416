import { EMPTY_PREFERENCES, type Preferences } from '@shared/domain/preferences.ts';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

import { api } from '@/lib/api';

import { useAuth } from './useAuth';

interface ProfileState {
  /** My display name; null until I've picked one ("what should we call you?"). */
  displayName: string | null;
  /** My survey answers (FR-02); empty until onboarding. */
  preferences: Preferences;
  /** True once the survey was saved or skipped; false shows onboarding. */
  onboarded: boolean;
  /** True while the signed-in user's profile is being read. */
  loading: boolean;
  /** True when the read failed; the app then skips the name and survey steps instead of blocking. */
  failed: boolean;
  /** Saves through POST /me and updates everyone reading this context. */
  saveDisplayName(name: string): Promise<void>;
  /** Saves through POST /me/preferences; also finishes onboarding. */
  savePreferences(preferences: Preferences): Promise<void>;
}

const ProfileContext = createContext<ProfileState>({
  displayName: null,
  preferences: EMPTY_PREFERENCES,
  onboarded: false,
  loading: false,
  failed: false,
  saveDisplayName: async () => {},
  savePreferences: async () => {},
});

interface Loaded {
  userId: string | null;
  displayName: string | null;
  preferences: Preferences;
  onboarded: boolean;
  failed: boolean;
}

/** Reads my profile (GET /me) once per signed-in user (not on every token refresh). */
export function ProfileProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const [state, setState] = useState<Loaded>({
    userId: null,
    displayName: null,
    preferences: EMPTY_PREFERENCES,
    onboarded: false,
    failed: false,
  });

  useEffect(() => {
    if (!userId) return;
    let active = true;
    // Like useAuth: an unreachable backend must not leave the app on a blank screen.
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), 4000),
    );
    Promise.race([api.getMe(), timeout])
      .then((me) => active && setState({ userId, ...me, failed: false }))
      .catch(
        () =>
          active &&
          setState({
            userId,
            displayName: null,
            preferences: EMPTY_PREFERENCES,
            onboarded: false,
            failed: true,
          }),
      );
    return () => {
      active = false;
    };
  }, [userId]);

  const saveDisplayName = useCallback(async (name: string) => {
    const { displayName } = await api.updateMe(name);
    setState((s) => ({ ...s, displayName, failed: false }));
  }, []);

  const savePreferences = useCallback(async (next: Preferences) => {
    const { preferences, onboarded } = await api.savePreferences(next);
    setState((s) => ({ ...s, preferences, onboarded }));
  }, []);

  const current = state.userId === userId;
  const value: ProfileState = {
    displayName: current ? state.displayName : null,
    preferences: current ? state.preferences : EMPTY_PREFERENCES,
    onboarded: current && state.onboarded,
    loading: !!userId && !current,
    failed: current && state.failed,
    saveDisplayName,
    savePreferences,
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
