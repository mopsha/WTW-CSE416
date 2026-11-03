import type { UserProfile } from '@shared/api/userProfiles.ts';
import { OwnProfileDetails } from '@/components/OwnProfileDetails';
import { Ionicons } from '@expo/vector-icons';
import { ListRow, Sheet } from '@/components/TabUi';
import { DISPLAY_NAME_MAX, validateDisplayName } from '@shared/api/profile.ts';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  Avatar,
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
    <Screen edges={['top', 'left', 'right']} contentStyle={{ flexGrow: 1 }}>
      <Pressable
        style={styles.identity}
        onPress={() => setDraft(displayName ?? suggestedName(session.user.email))}
        accessibilityRole="button"
        accessibilityLabel={`Edit profile for ${name}`}
      >
        <Avatar name={name} uri={details?.avatarUrl} neutral size={84} />
        <View style={styles.who}>
          <Text style={styles.name}>{name}</Text>
          {details?.username ? <Text style={styles.email}>@{details.username}</Text> : null}
          <Text style={styles.email}>{email}</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.muted} />
      </Pressable>
      {detailsError ? (
        <ErrorState message={detailsError} onRetry={() => void loadDetails()} />
      ) : null}
      {details ? <OwnProfileDetails profile={details} onSaved={setDetails} /> : null}
      <View style={styles.settings}>
        <ListRow
          title="Preferences"
          subtitle={preferencesSummary(preferences)}
          leading={<Ionicons name="heart-outline" size={25} color={colors.text} />}
          onPress={() => router.push('/preferences')}
        />
        <ListRow
          title="Notifications"
          leading={<Ionicons name="notifications-outline" size={25} color={colors.text} />}
          onPress={() =>
            router.push({ pathname: '/settings', params: { section: 'notifications' } })
          }
        />
        <ListRow
          title="Settings"
          leading={<Ionicons name="settings-outline" size={25} color={colors.text} />}
          onPress={() => router.push('/settings')}
        />
      </View>
      {error ? <ErrorState message={error} /> : null}
      <View style={styles.footer}>
        <ListRow
          title="Sign out"
          danger
          disabled={!!busy}
          leading={<Ionicons name="log-out-outline" size={23} color={colors.primary} />}
          right={<View />}
          onPress={() => void run('logout', () => accountActions.logOut())}
        />
        <ListRow
          title="Delete account"
          muted
          disabled={!!busy}
          leading={<Ionicons name="trash-outline" size={23} color={colors.muted} />}
          right={busy === 'delete' ? <ActivityIndicator color={colors.primary} /> : <View />}
          onPress={() => void deleteAccount()}
        />
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
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    paddingTop: space.xxl + space.xl,
    paddingBottom: space.xl,
  },
  settings: { borderTopWidth: 1, borderTopColor: colors.border },
  footer: { marginTop: 'auto', paddingTop: space.xxl },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  who: { flex: 1, gap: 2 },
  name: { ...type.heading, color: colors.text },
  email: { ...type.caption, color: colors.muted },
  edit: { marginTop: space.lg },
  form: { gap: space.md, marginTop: space.lg },
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
