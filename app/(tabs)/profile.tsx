import { profileTheme } from '@/components/theme';
import {
  ProfileHero,
  ProfileFavorites,
  ProfileRow,
} from '@/components/profile/ProfilePresentation';
import { PastMoves } from '@/components/PastMoves';
import type { UserProfile } from '@shared/api/userProfiles.ts';
import { OwnProfileDetails } from '@/components/OwnProfileDetails';
import { Sheet } from '@/components/TabUi';
import { DISPLAY_NAME_MAX, validateDisplayName } from '@shared/api/profile.ts';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  Button,
  colors,
  ErrorState,
  fonts,
  MIN_TARGET,
  radius,
  Screen,
  space,
  type,
} from '@/components';
import { useAction } from '@/hooks/useAction';
import { useSession } from '@/hooks/useAuth';
import { suggestedName, useProfile } from '@/hooks/useProfile';
import { api } from '@/lib/api';
import { accountActions } from '@/lib/accountActions';
import { preferencesSummary } from '@/lib/preferences';

// My name (what friends see in Picks), my email, preferences, notifications, sign-out, and
// account deletion (App Store 5.1.1(v): reachable from here in two taps).
export default function ProfileScreen() {
  const session = useSession();
  const { displayName, preferences, saveDisplayName } = useProfile();
  const email = session.user.email ?? 'you';
  const name = displayName || suggestedName(session.user.email) || email;
  const [details, setDetails] = useState<UserProfile | null>(null);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<string | null>(null);
  const { busy, error, run, clearError } = useAction();

  const loadDetails = useCallback(async () => {
    try {
      setDetails(await api.getMyUserProfile());
      setDetailsError(null);
    } catch (e) {
      setDetails(null);
      setDetailsError(e instanceof Error ? e.message : 'Could not load profile details');
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      void loadDetails();
    }, [loadDetails]),
  );

  async function save() {
    if (draft === null) return;
    const result = validateDisplayName(draft);
    if ('error' in result) {
      setInvalid(result.error);
      return;
    }
    if (await run('save', () => saveDisplayName(result.name))) setDraft(null);
  }

  function cancel() {
    if (busy) return;
    setDraft(null);
    setInvalid(null);
    clearError();
  }

  async function deleteAccount() {
    await run('delete', () => accountActions.deleteAccount());
  }

  return (
    <Screen edges={['top', 'left', 'right']} contentStyle={styles.content}>
      <ProfileHero name={name} profile={details} />
      <Button
        label="Edit profile"
        variant="secondary"
        style={styles.editProfile}
        accessibilityLabel={`Edit profile for ${name}`}
        onPress={() => setDraft(displayName ?? suggestedName(session.user.email))}
      />
      {!details && !detailsError ? (
        <ActivityIndicator color={colors.primary} accessibilityLabel="Loading profile details" />
      ) : null}
      {detailsError ? (
        <ErrorState message={detailsError} onRetry={() => void loadDetails()} />
      ) : null}
      {details ? <ProfileFavorites profile={details} /> : null}
      <PastMoves key={session.user.id} userId={session.user.id} variant="profile" />
      <View style={styles.account}>
        {details ? (
          <OwnProfileDetails
            profile={details}
            onSaved={setDetails}
            variant="profile"
            email={email}
          />
        ) : null}
        <View style={styles.settings}>
          <ProfileRow
            title="Preferences"
            subtitle={preferencesSummary(preferences)}
            icon="heart-outline"
            onPress={() => router.push('/preferences')}
          />
          <ProfileRow
            title="Notifications"
            icon="notifications-outline"
            onPress={() =>
              router.push({ pathname: '/settings', params: { section: 'notifications' } })
            }
          />
          <ProfileRow
            title="Settings"
            icon="settings-outline"
            onPress={() => router.push('/settings')}
          />
        </View>
        {error ? <ErrorState message={error} /> : null}
        <View style={styles.footer}>
          <ProfileRow
            title="Sign out"
            tone="accent"
            disabled={!!busy}
            icon="log-out-outline"
            onPress={() => void run('logout', () => accountActions.logOut())}
          />
          <ProfileRow
            title="Delete account"
            tone="quiet"
            disabled={!!busy}
            icon="trash-outline"
            loading={busy === 'delete'}
            onPress={() => void deleteAccount()}
          />
        </View>
      </View>
      <Sheet title="Edit profile" visible={draft !== null} onClose={cancel}>
        <Text style={styles.detail}>The name your friends see in Picks.</Text>
        <TextInput
          style={styles.input}
          value={draft ?? ''}
          onChangeText={(text) => {
            setDraft(text);
            setInvalid(null);
          }}
          placeholder="Your name"
          placeholderTextColor={colors.muted}
          autoCapitalize="words"
          autoComplete="name"
          textContentType="name"
          maxLength={DISPLAY_NAME_MAX * 2}
          returnKeyType="done"
          onSubmitEditing={() => void save()}
          accessibilityLabel="Your name"
          editable={!busy}
        />
        {invalid ? (
          <Text style={styles.invalid} accessibilityLiveRegion="polite">
            {invalid}
          </Text>
        ) : null}
        {error ? <ErrorState message={error} /> : null}
        <Button
          label="Save"
          onPress={() => void save()}
          loading={busy === 'save'}
          disabled={!draft?.trim()}
        />
        <Button label="Cancel" variant="link" onPress={cancel} disabled={!!busy} />
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.lg, paddingTop: space.sm },
  editProfile: {
    borderRadius: radius.sm,
    borderWidth: 0,
    minHeight: MIN_TARGET,
    paddingVertical: 0,
  },
  account: { marginTop: space.xl, gap: space.lg },
  settings: { backgroundColor: profileTheme.surface, borderRadius: radius.md, overflow: 'hidden' },
  footer: { paddingTop: space.sm, paddingBottom: space.lg },
  input: {
    minHeight: MIN_TARGET + 4,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: space.lg + 2,
    fontFamily: fonts.medium,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.cardHi,
  },
  invalid: { ...type.caption, color: colors.danger },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm },
  save: { minWidth: 120 },
  cardTitle: { fontFamily: fonts.bold, fontSize: 17, color: colors.text },
  detail: { ...type.body, color: colors.muted },
});
