import { useFocusEffect, useLocalSearchParams, router } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { AppState, Linking, Platform, Text, View } from 'react-native';
import { Button, Card, ErrorState, Screen, colors, space, type } from '@/components';
import { ListRow, SectionHeading, Sheet } from '@/components/TabUi';
import { useAction } from '@/hooks/useAction';
import { accountActions } from '@/lib/accountActions';
import { PRIVACY_URL, SUPPORT_URL, TERMS_URL } from '@/lib/legal';
import { ensureNotificationPermission } from '@/lib/notify';
import { registerForPush } from '@/lib/push';
import {
  openDeviceSettings,
  readSettingsPermissions,
  type SettingsPermissions,
} from '@/lib/settingsPermissions';

type Panel = 'notifications' | 'location' | 'help' | 'data';
export default function SettingsScreen() {
  const { section } = useLocalSearchParams<{ section?: string }>();
  const [panel, setPanel] = useState<Panel | null>(
    section === 'notifications' ? 'notifications' : null,
  );
  const [permissions, setPermissions] = useState<SettingsPermissions | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const action = useAction();
  const latest = useRef(0);
  const native = Platform.OS !== 'web';
  const load = useCallback(async () => {
    const request = ++latest.current;
    const value = await readSettingsPermissions();
    if (request === latest.current) setPermissions(value);
  }, []);
  useFocusEffect(
    useCallback(() => {
      void load();
      const sub = AppState.addEventListener('change', (state) => {
        if (state === 'active') void load();
      });
      return () => {
        latest.current++;
        sub.remove();
      };
    }, [load]),
  );
  const open = (next: Panel) => {
    action.clearError();
    setNotice(null);
    setPanel(next);
  };
  const enableNotifications = async () => {
    await action.run('notifications', async () => {
      if (await ensureNotificationPermission()) {
        const registered = await registerForPush();
        setNotice(
          registered
            ? 'This device is registered for push notifications.'
            : 'Notification permission is on, but push registration is unavailable. You can still use your inbox.',
        );
      } else {
        setNotice('You can manage notification access in your phone’s Settings.');
      }
      await load();
    });
  };
  const location =
    permissions?.location === 'granted'
      ? 'Allowed while using WTW'
      : permissions?.location === 'denied'
        ? 'Not allowed'
        : permissions?.location === 'undetermined'
          ? 'Not requested'
          : 'Status unavailable';
  return (
    <Screen title="Settings" back>
      {action.error ? <ErrorState message={action.error} /> : null}
      <SectionHeading title="Profile" />
      <Card>
        <ListRow
          title="Edit profile"
          subtitle="Name, username and favorites"
          onPress={() => router.push('/settings/profile')}
        />
        <ListRow
          title="Profile privacy"
          subtitle="Control metadata shared with friends"
          onPress={() =>
            router.push({ pathname: '/settings/profile', params: { section: 'privacy' } })
          }
        />
      </Card>
      <SectionHeading title="Preferences" />
      <Card>
        <ListRow
          title="Notifications"
          subtitle={
            native
              ? permissions === null
                ? 'Checking permission…'
                : permissions.notifications
                  ? 'Permission allowed'
                  : 'Permission not allowed'
              : 'Inbox available; push requires the mobile app'
          }
          onPress={() => open('notifications')}
        />
        <ListRow
          title="Location"
          subtitle={
            native
              ? permissions === null
                ? 'Checking permission…'
                : location
              : 'Managed in browser site permissions'
          }
          onPress={() => open('location')}
        />
        <ListRow title="Food & activity preferences" onPress={() => router.push('/preferences')} />
      </Card>
      <SectionHeading title="Safety & privacy" />
      <Card>
        <ListRow title="Blocked users" onPress={() => router.push('/settings/blocked')} />
      </Card>
      <SectionHeading title="Your activity" />
      <Card>
        <ListRow title="History" onPress={() => router.push('/history')} />
        <ListRow title="Manage groups" onPress={() => router.push('/groups')} />
      </Card>
      <SectionHeading title="Account" />
      <Card>
        <ListRow
          title="Log out"
          disabled={!!action.busy}
          onPress={() => void action.run('logout', () => accountActions.logOut())}
        />
        <ListRow
          title="Delete account"
          danger
          disabled={!!action.busy}
          onPress={() => void action.run('delete', () => accountActions.deleteAccount())}
        />
        {action.busy === 'logout' || action.busy === 'delete' ? (
          <Text style={{ ...type.caption, color: colors.muted }} accessibilityLiveRegion="polite">
            {action.busy === 'delete' ? 'Confirming account deletion…' : 'Signing out…'}
          </Text>
        ) : null}
      </Card>
      <SectionHeading title="Help & information" />
      <Card>
        <ListRow title="Help" onPress={() => open('help')} />
        <ListRow title="Data & privacy information" onPress={() => open('data')} />
        <ListRow
          title="Support"
          onPress={() => void Linking.openURL(SUPPORT_URL).catch(() => {})}
        />
        <ListRow
          title="Privacy Policy"
          onPress={() => void Linking.openURL(PRIVACY_URL).catch(() => {})}
        />
        <ListRow
          title="Terms of Use"
          onPress={() => void Linking.openURL(TERMS_URL).catch(() => {})}
        />
      </Card>
      <Sheet
        title={
          panel === 'notifications'
            ? 'Notifications'
            : panel === 'location'
              ? 'Location'
              : panel === 'help'
                ? 'Help'
                : 'Data & privacy information'
        }
        visible={panel !== null}
        onClose={() => {
          if (!action.busy) setPanel(null);
        }}
      >
        <View style={{ gap: space.md }}>
          {action.error ? <ErrorState message={action.error} /> : null}
          {notice ? (
            <Text style={{ ...type.body, color: colors.text }} accessibilityLiveRegion="polite">
              {notice}
            </Text>
          ) : null}
          {panel === 'notifications' ? (
            <>
              <Button
                label="Open notification inbox"
                variant="secondary"
                onPress={() => {
                  setPanel(null);
                  router.push('/inbox');
                }}
              />
              <Text style={{ ...type.body, color: colors.muted }}>
                {native
                  ? 'WTW uses your device’s notification permission. Push delivery also requires this device to be registered. There are no per-category notification controls.'
                  : 'Push notifications are available in the mobile app. Your in-app inbox works here.'}
              </Text>
              {native ? (
                <>
                  <Button
                    label={
                      permissions?.notifications
                        ? 'Register this device for push'
                        : 'Enable notifications'
                    }
                    loading={action.busy === 'notifications'}
                    onPress={() => void enableNotifications()}
                  />
                  <Button
                    label="Open device settings"
                    variant="secondary"
                    disabled={!!action.busy}
                    onPress={() => void action.run('system', openDeviceSettings)}
                  />
                </>
              ) : null}
            </>
          ) : panel === 'location' ? (
            <>
              <Text style={{ ...type.body, color: colors.text }}>
                {native
                  ? location
                  : 'Location permission is managed in your browser’s site settings.'}
              </Text>
              <Text style={{ ...type.body, color: colors.muted }}>
                WTW asks for foreground location when you choose your current location for Discover
                or a Pick. You can choose a meeting point manually. Opening Settings does not
                request access or read your location.
              </Text>
              {native ? (
                <Button
                  label="Open device settings"
                  variant="secondary"
                  loading={action.busy === 'system'}
                  onPress={() => void action.run('system', openDeviceSettings)}
                />
              ) : null}
            </>
          ) : panel === 'help' ? (
            <>
              <Text style={{ ...type.body, color: colors.text }}>
                Start a Pick, invite friends or share its code, then swipe on the shared options.
                Your group’s results appear in the Pick and History.
              </Text>
              <Text style={{ ...type.body, color: colors.muted }}>
                Group invitations appear on Friends and require acceptance. Group Ideas are included
                only when the host enables them for a group Pick.
              </Text>
              <Text style={{ ...type.body, color: colors.muted }}>
                If something fails, check your connection and use Retry. For notification or
                location access, check the relevant device permission. For anything else, open
                Support in Settings.
              </Text>
            </>
          ) : panel === 'data' ? (
            <>
              <Text style={{ ...type.body, color: colors.text }}>
                This is a short summary. The Privacy Policy in Settings has the full details.
              </Text>
              <Text style={{ ...type.body, color: colors.muted }}>
                Your email is used for sign-in. Your profile, preferences, group memberships, saved
                places and Pick activity are stored for the features you use. Push tokens are
                registered for device notifications.
              </Text>
              <Text style={{ ...type.body, color: colors.muted }}>
                Profile metadata sharing is off by default. When enabled, accepted, unblocked
                friends can see counts and favorites. Mutual groups show only shared memberships.
                Discover preferences stay private.
              </Text>
              <Text style={{ ...type.body, color: colors.muted }}>
                A Pick stores the meeting point selected by its host. Delete account removes your
                account and personal settings; shared Pick history may remain without your account.
              </Text>
            </>
          ) : null}
        </View>
      </Sheet>
    </Screen>
  );
}
