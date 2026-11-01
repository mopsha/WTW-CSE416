import { DISPLAY_NAME_MAX, validateDisplayName } from '@shared/api/profile.ts';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Linking, Platform, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  Avatar,
  Button,
  Card,
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
import { api, ApiError } from '@/lib/api';
import { auth } from '@/lib/auth';
import { confirmAction } from '@/lib/confirm';
import { ensureNotificationPermission, notificationsAllowed } from '@/lib/notify';
import { preferencesSummary } from '@/lib/preferences';
import { registerForPush } from '@/lib/push';

// My name (what friends see in Picks), my email, preferences, notifications, sign-out, and
// account deletion (App Store 5.1.1(v): reachable from here in two taps).
export default function ProfileScreen() {
  const session = useSession();
  const { displayName, preferences, saveDisplayName } = useProfile();
  const email = session.user.email ?? 'you';
  const name = displayName || suggestedName(session.user.email) || email;
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<boolean | null>(null);
  const { busy, error, run, clearError } = useAction();
  const native = Platform.OS !== 'web';

  // Re-check when the tab comes back into view: the user may have changed it in Settings.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      void notificationsAllowed().then((on) => active && setNotifications(on));
      return () => {
        active = false;
      };
    }, []),
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
    setDraft(null);
    setInvalid(null);
    clearError();
  }

  async function turnOnNotifications() {
    if (await ensureNotificationPermission()) {
      setNotifications(true);
      void registerForPush();
    } else {
      // Already declined once: only Settings can turn them on now.
      void Linking.openSettings();
    }
  }

  async function deleteAccount() {
    const ok = await confirmAction({
      title: 'Delete your account?',
      message:
        'This permanently deletes your account and everything in it: your name, your preferences and your saved places. It can’t be undone.',
      confirmLabel: 'Delete account',
      destructive: true,
    });
    if (!ok) return;
    const deleted = await run('delete', async () => {
      try {
        await api.deleteMe();
      } catch (e) {
        // Razin's DELETE /me isn't on every backend yet.
        if (e instanceof ApiError && e.status === 404) {
          throw new Error('Account deletion isn’t available yet. Please try again later.');
        }
        throw e;
      }
    });
    if (!deleted) return;
    if (native) Alert.alert('Your account was deleted', 'Thanks for trying WTW.');
    await auth.signOut();
  }

  return (
    <Screen title="Profile" edges={['top', 'left', 'right']}>
      <Card>
        <View style={styles.row}>
          <Avatar name={draft?.trim() || name} size={56} />
          <View style={styles.who}>
            <Text style={styles.name}>{name}</Text>
            <Text style={styles.email}>{email}</Text>
          </View>
        </View>
        {draft === null ? (
          <Button
            label={displayName ? 'Edit name' : 'Set your name'}
            variant="secondary"
            icon="create-outline"
            accessibilityHint="Changes the name your friends see in Picks"
            onPress={() => setDraft(displayName ?? suggestedName(session.user.email))}
            style={styles.edit}
          />
        ) : (
          <View style={styles.form}>
            <TextInput
              style={styles.input}
              value={draft}
              onChangeText={(text) => {
                setDraft(text);
                setInvalid(null);
              }}
              placeholder="Your name"
              placeholderTextColor={colors.muted}
              autoCapitalize="words"
              autoComplete="name"
              textContentType="name"
              autoFocus
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
            <View style={styles.actions}>
              <Button label="Cancel" variant="link" onPress={cancel} disabled={!!busy} />
              <Button
                label="Save"
                onPress={() => void save()}
                loading={busy === 'save'}
                disabled={!draft.trim()}
                style={styles.save}
              />
            </View>
          </View>
        )}
      </Card>

      <Card>
        <Text style={styles.cardTitle} accessibilityRole="header">
          Your preferences
        </Text>
        <Text style={styles.detail}>{preferencesSummary(preferences)}</Text>
        <Button
          label="Edit preferences"
          variant="secondary"
          icon="options-outline"
          accessibilityHint="Changes what Discover and your Picks suggest"
          onPress={() => router.push('/preferences')}
        />
      </Card>

      {native ? (
        <Card>
          <Text style={styles.cardTitle} accessibilityRole="header">
            Notifications
          </Text>
          <Text style={styles.detail}>
            {notifications === null
              ? ' '
              : notifications
                ? 'On. To turn them off, use your phone’s Settings.'
                : 'Off. Turn them on to hear when your group is ready.'}
          </Text>
          {notifications === false ? (
            <Button
              label="Turn on notifications"
              variant="secondary"
              icon="notifications-outline"
              onPress={() => void turnOnNotifications()}
            />
          ) : notifications ? (
            <Button
              label="Open Settings"
              variant="link"
              onPress={() => void Linking.openSettings()}
            />
          ) : null}
        </Card>
      ) : null}

      {error ? <ErrorState message={error} /> : null}
      <Button
        label="Sign out"
        variant="danger"
        icon="log-out-outline"
        disabled={!!busy}
        onPress={() => void auth.signOut()}
      />
      <Button
        label="Delete account"
        variant="link"
        icon="trash-outline"
        loading={busy === 'delete'}
        accessibilityHint="Permanently deletes your account after you confirm"
        onPress={() => void deleteAccount()}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
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
