import { sameBirthday, type Birthday } from '@shared/api/birthdays.ts';
import type { ProfileDetailsInput, UserProfile } from '@shared/api/userProfiles.ts';
import { EMPTY_PREFERENCES, type Preferences } from '@shared/domain/preferences.ts';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

import { api } from '@/lib/api';

import { useAuth } from './useAuth';

interface ProfileState {
  /** My display name; null until I've picked one ("what should we call you?"). */
  username: string | null;
  birthdayRequired?: boolean;
  optionalSetupPending: boolean;
  displayName: string | null;
  /** My survey answers (FR-02); empty until onboarding. */
  preferences: Preferences;
  /** Legacy Discover survey status; does not gate navigation. */
  onboarded: boolean;
  /** True while the signed-in user's profile is being read. */
  loading: boolean;
  /** True when the read failed; identity setup offers retry instead of assuming completion. */
  failed: boolean;
  /** Saves through POST /me and updates everyone reading this context. */
  completeIdentity(name: string, username: string, birthday?: Birthday | null): Promise<void>;
  finishOptionalSetup(): Promise<void>;
  retry(): void;
  saveDisplayName(name: string): Promise<void>;
  saveProfileDetails(input: ProfileDetailsInput): Promise<UserProfile>;
  /** Saves through POST /me/preferences; also finishes onboarding. */
  savePreferences(preferences: Preferences): Promise<void>;
}

const ProfileContext = createContext<ProfileState>({
  username: null,
  optionalSetupPending: false,
  displayName: null,
  preferences: EMPTY_PREFERENCES,
  onboarded: false,
  loading: false,
  failed: false,
  completeIdentity: async () => {},
  finishOptionalSetup: async () => {},
  retry: () => {},
  saveDisplayName: async () => {},
  saveProfileDetails: async () => {
    throw new Error('Profile unavailable');
  },
  savePreferences: async () => {},
});

interface Loaded {
  attempt: number;
  userId: string | null;
  username: string | null;
  birthdayRequired?: boolean;
  optionalSetupPending: boolean;
  displayName: string | null;
  preferences: Preferences;
  onboarded: boolean;
  failed: boolean;
}

/** Reads my profile (GET /me) once per signed-in user (not on every token refresh). */
export function ProfileProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<Loaded>({
    attempt: -1,
    userId: null,
    username: null,
    optionalSetupPending: false,
    displayName: null,
    preferences: EMPTY_PREFERENCES,
    onboarded: false,
    failed: false,
  });

  useEffect(() => {
    let active = true;
    if (!userId) {
      void Promise.resolve().then(() => active && setState((s) => ({ ...s, userId: null })));
      return () => {
        active = false;
      };
    }
    // Like useAuth: an unreachable backend must not leave the app on a blank screen.
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>(
      (_, reject) => (timer = setTimeout(() => reject(new Error('timeout')), 4000)),
    );
    Promise.race([api.getMe(), timeout])
      .then((me) => active && setState({ attempt, userId, ...me, failed: false }))
      .catch(
        () =>
          active &&
          setState({
            attempt,
            userId,
            username: null,
            optionalSetupPending: false,
            displayName: null,
            preferences: EMPTY_PREFERENCES,
            onboarded: false,
            failed: true,
          }),
      )
      .finally(() => clearTimeout(timer));
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [userId, attempt]);

  const completeIdentity = useCallback(
    async (name: string, username: string, birthday?: Birthday | null) => {
      const saved = await api.completeIdentity(name, username, birthday);
      if (birthday && !sameBirthday(saved.birthday, birthday))
        throw new Error('Birthday could not be confirmed saved. Please try again.');
      setState((s) =>
        s.userId !== userId
          ? s
          : {
              ...s,
              displayName: saved.displayName,
              username: saved.username,
              birthdayRequired: saved.birthdayRequired ?? false,
              failed: false,
            },
      );
    },
    [userId],
  );
  const finishOptionalSetup = useCallback(async () => {
    await api.finishOptionalSetup();
    setState((s) => (s.userId !== userId ? s : { ...s, optionalSetupPending: false }));
  }, [userId]);
  const saveDisplayName = useCallback(
    async (name: string) => {
      const { displayName } = await api.updateMe(name);
      setState((s) => (s.userId !== userId ? s : { ...s, displayName, failed: false }));
    },
    [userId],
  );

  const saveProfileDetails = useCallback(
    async (input: ProfileDetailsInput) => {
      const saved = await api.updateProfileDetails(input);
      if (saved.id !== userId || !saved.isOwner) throw new Error('Unexpected profile response');
      if (
        ('birthday' in input && !sameBirthday(saved.birthday, input.birthday)) ||
        ('shareBirthday' in input && (saved.shareBirthday ?? false) !== input.shareBirthday)
      )
        throw new Error(
          'Birthday changes could not be confirmed saved. Reload your profile and try again.',
        );
      setState((s) =>
        s.userId !== userId
          ? s
          : { ...s, username: saved.username, birthdayRequired: saved.birthdayRequired ?? false },
      );
      return saved;
    },
    [userId],
  );

  const savePreferences = useCallback(
    async (next: Preferences) => {
      const { preferences, onboarded } = await api.savePreferences(next);
      setState((s) => (s.userId !== userId ? s : { ...s, preferences, onboarded }));
    },
    [userId],
  );

  const current = state.userId === userId && state.attempt === attempt;
  const value: ProfileState = {
    birthdayRequired: current && !!state.birthdayRequired,
    username: current ? state.username : null,
    optionalSetupPending: current && state.optionalSetupPending,
    displayName: current ? state.displayName : null,
    preferences: current ? state.preferences : EMPTY_PREFERENCES,
    onboarded: current && state.onboarded,
    loading: !!userId && !current,
    failed: current && state.failed,
    completeIdentity,
    finishOptionalSetup,
    retry: () => setAttempt((n) => n + 1),
    saveDisplayName,
    saveProfileDetails,
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
