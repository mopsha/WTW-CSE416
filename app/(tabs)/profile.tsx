import { Ionicons } from '@expo/vector-icons';
import { ListRow, Sheet } from '@/components/TabUi';
import { DISPLAY_NAME_MAX, validateDisplayName } from '@shared/api/profile.ts';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

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
import { api, ApiError } from '@/lib/api';
import { auth } from '@/lib/auth';
import { confirmAction } from '@/lib/confirm';
import { ensureNotificationPermission, notificationsAllowed } from '@/lib/notify';
import { preferencesSummary } from '@/lib/preferences';
import { registerForPush, unregisterFromPush } from '@/lib/push';

// My name (what friends see in Picks), my email, preferences, notifications, sign-out, and
// account deletion (App Store 5.1.1(v): reachable from here in two taps).
export default function ProfileScreen() {
  const session = useSession();
  const { displayName, preferences, saveDisplayName } = useProfile();
  const email = session.user.email ?? 'you';
  const name = displayName || suggestedName(session.user.email) || email;
  const [panel, setPanel] = useState<'notifications' | 'settings' | null>(null);
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
    if (busy) return;
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
    <Screen edges={['top', 'left', 'right']} contentStyle={{ flexGrow: 1 }}>
      <Pressable
        style={styles.identity}
        onPress={() => setDraft(displayName ?? suggestedName(session.user.email))}
        accessibilityRole="button"
        accessibilityLabel={`Edit profile for ${name}`}
      >
        <Avatar name={name} neutral size={84} />
        <View style={styles.who}>
          <Text style={styles.name}>{name}</Text>
          <Text style={styles.email}>{email}</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.muted} />
      </Pressable>
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
          onPress={() => setPanel('notifications')}
        />
        <ListRow
          title="Settings"
          leading={<Ionicons name="settings-outline" size={25} color={colors.text} />}
          onPress={() => setPanel('settings')}
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
          onPress={() => void unregisterFromPush().finally(() => auth.signOut())}
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
      <Sheet
        title={panel === 'settings' ? 'Settings' : 'Notifications'}
        visible={panel !== null}
        onClose={() => setPanel(null)}
      >
        {panel === 'notifications' ? (
          <>
            <Button
              label="Open notification inbox"
              icon="notifications-outline"
              variant="secondary"
              onPress={() => {
                setPanel(null);
                router.push('/inbox');
              }}
            />
            {native ? (
              <>
                <Text style={styles.detail}>
                  {notifications === null
                    ? 'Checking notification permissions…'
                    : notifications
                      ? 'Notifications are on. Manage them in your phone’s Settings.'
                      : 'Notifications are off. Turn them on to hear when your group is ready.'}
                </Text>
                {notifications === false ? (
                  <Button
                    label="Turn on notifications"
                    onPress={() => void turnOnNotifications()}
                  />
                ) : notifications ? (
                  <Button
                    label="Open Settings"
                    variant="link"
                    onPress={() => void Linking.openSettings()}
                  />
                ) : null}
              </>
            ) : null}
          </>
        ) : (
          <>
            <Button
              label="History"
              variant="secondary"
              icon="time-outline"
              onPress={() => {
                setPanel(null);
                router.push('/history');
              }}
            />
            <Button
              label="Manage groups"
              variant="secondary"
              icon="people-outline"
              onPress={() => {
                setPanel(null);
                router.push('/groups');
              }}
            />
            {native ? (
              <Button
                label="Open phone settings"
                variant="link"
                onPress={() => void Linking.openSettings()}
              />
            ) : null}
          </>
        )}
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
