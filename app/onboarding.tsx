import type { Preferences } from '@shared/domain/preferences.ts';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';

import {
  Button,
  colors,
  ErrorState,
  Illustration,
  OnboardingCopy,
  OnboardingFrame,
  PageDots,
  PreferencesForm,
  Screen,
  space,
} from '@/components';
import { TasteSwipe } from '@/components/TasteSwipe';
import { useProfile } from '@/hooks/useProfile';
import { messageOf } from '@/lib/errors';
import { currentLocation } from '@/lib/locationSearch';
import {
  readLocationPermission,
  readNotificationPermission,
  requestLocationPermission,
  requestNotificationPermission,
  type PermissionInfo,
} from '@/lib/permissions';
import { registerForPush } from '@/lib/push';
import { openDeviceSettings } from '@/lib/settingsPermissions';
import { preferencesFromSwipes } from '@/lib/tasteDeck';

// Location comes first so the practice swipe can show real places nearby.
const FULL = ['location', 'taste', 'preferences', 'notifications', 'done'] as const;
// From the Home "Teach WTW your taste" card: just the taste part.
const TASTE_ONLY = ['taste', 'preferences'] as const;
type Step = (typeof FULL)[number];
type PermissionStep = 'location' | 'notifications';
type LatLng = { lat: number; lng: number };

const COPY: Record<
  PermissionStep,
  Record<'ask' | 'granted' | 'denied', string> & { title: string }
> = {
  location: {
    title: 'Find spots near you',
    ask: 'WTW uses your location while the app is open to show places nearby.',
    granted: 'Location is on, so nearby spots show up first.',
    denied: 'Location is off. You can drop a pin on the map instead.',
  },
  notifications: {
    title: 'Know when it’s time',
    ask: 'Get a heads-up when your group starts a Pick, votes or has a winner.',
    granted: 'Notifications are on. We’ll tell you when your group is ready.',
    denied: 'Notifications are off. Open WTW any time to check your Picks.',
  },
};

/** Where the user is, only if location is already allowed; never prompts, never throws. */
async function knownLocation(info: PermissionInfo): Promise<LatLng | null> {
  if (info.status !== 'granted') return null;
  try {
    return await currentLocation();
  } catch {
    return null;
  }
}

// Optional routes are part of the signed-in stack: neither permissions nor this offer gate Picks.
// Permission steps follow App Store guideline 5.1.1: our button says "Continue" and only that
// tap shows the system prompt; "Not now" moves on with no prompt; a decided permission is never
// asked again. Opening a step only reads the status.
export default function OnboardingScreen() {
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const steps: readonly Step[] = mode === 'taste' ? TASTE_ONLY : FULL;
  const profile = useProfile();
  const { finishOptionalSetup } = profile;
  const [step, setStep] = useState<Step>(steps[0]!);
  // undefined = still looking up (taste-only mode), so the deck is built once, not swapped.
  const [center, setCenter] = useState<LatLng | null | undefined>(
    mode === 'taste' ? undefined : null,
  );
  const [draft, setDraft] = useState<Preferences>(profile.preferences);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permission, setPermission] = useState<PermissionInfo | null>(null);
  const pending = useRef(false);
  const finished = useRef(false);

  const permissionStep: PermissionStep | null =
    step === 'location' || step === 'notifications' ? step : null;

  // Read-only status for the current permission step, refreshed when returning from Settings.
  useEffect(() => {
    if (!permissionStep) return;
    let active = true;
    const read = () =>
      void (permissionStep === 'location' ? readLocationPermission() : readNotificationPermission())
        .then((info) => active && setPermission(info))
        .catch(() => {});
    read();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && read());
    return () => {
      active = false;
      sub.remove();
    };
  }, [permissionStep]);

  // Taste-only mode skips the location step: use the location only if it's already allowed.
  useEffect(() => {
    if (mode !== 'taste') return;
    let active = true;
    void readLocationPermission()
      .then(knownLocation)
      .then((c) => active && setCenter(c))
      .catch(() => active && setCenter(null));
    return () => {
      active = false;
    };
  }, [mode]);

  async function act(work: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  const after = (current: Step): Step | null => steps[steps.indexOf(current) + 1] ?? null;
  function go(next: Step | null) {
    setPermission(null);
    setError(null);
    if (next === null) return enter();
    setStep(next);
    if (next === 'done') void markDone();
  }

  /** Records that setup was offered. Offline failures just mean it's offered again next start. */
  async function markDone() {
    if (finished.current || mode === 'taste') return;
    finished.current = true;
    try {
      await finishOptionalSetup();
    } catch {
      finished.current = false;
    }
  }

  function enter() {
    // Taste-only (Home card, Profile/Settings "Swipe again"): back to where it was opened from.
    if (mode === 'taste' && router.canGoBack()) return router.back();
    // Leave immediately; persisting the dismissal must not hold up entry when offline.
    router.replace('/');
    void markDone();
  }

  async function continuePermission() {
    if (step === 'location') {
      setCenter(await knownLocation(await requestLocationPermission()));
      go(after('location'));
    } else {
      const result = await requestNotificationPermission();
      if (result.status === 'granted') void registerForPush();
      go(after('notifications'));
    }
  }

  async function savePreferences() {
    await profile.savePreferences(draft);
    go(after('preferences'));
  }

  const dots = <PageDots index={steps.indexOf(step)} total={steps.length} noun="Step" />;
  const top =
    step === 'done' ? (
      dots
    ) : (
      <>
        {dots}
        <Button
          label={mode === 'taste' ? 'Close' : 'Skip setup'}
          accessibilityHint="Skips the optional setup and opens your Picks"
          variant="link"
          disabled={busy}
          onPress={enter}
        />
      </>
    );
  const banner = error ? <ErrorState variant="banner" message={error} /> : null;

  if (step === 'taste')
    return (
      <Screen scroll={false} contentStyle={styles.fill}>
        <View style={styles.topRow}>{top}</View>
        <OnboardingCopy
          title="What sounds good?"
          body="Swipe right for Yes, left for No, up for Maybe. WTW learns what you like."
        />
        <TasteSwipe
          key={center === undefined ? 'locating' : 'ready'}
          center={center}
          onDone={(answers) => {
            setDraft(preferencesFromSwipes(profile.preferences, answers));
            go('preferences');
          }}
        />
        <Button
          label="Skip swiping"
          accessibilityHint="Goes straight to the preferences form"
          variant="link"
          onPress={() => {
            setDraft(profile.preferences);
            go('preferences');
          }}
        />
      </Screen>
    );

  if (step === 'preferences')
    return (
      <Screen>
        <View style={styles.topRow}>{top}</View>
        <OnboardingCopy
          title="Here’s your taste"
          body="Fix anything that’s off, then set your budget and how far you’ll go."
        />
        <PreferencesForm value={draft} onChange={setDraft} />
        {banner}
        <Button label="Save" loading={busy} onPress={() => void act(savePreferences)} />
        <Button
          label="Not now"
          accessibilityHint="Continues without saving preferences"
          variant="link"
          disabled={busy}
          onPress={() => go(after('preferences'))}
        />
      </Screen>
    );

  if (step === 'done')
    return (
      <OnboardingFrame
        top={top}
        art={
          <Illustration
            icon="thumbs-up"
            badges={[
              { icon: 'checkmark', color: colors.yes },
              { icon: 'star', color: colors.maybe },
            ]}
          />
        }
        title="You’re all set"
        body="Start a Pick, invite friends and let WTW find the winner."
        actions={<Button label="Start picking" onPress={enter} />}
      />
    );

  const copy = COPY[step];
  const status = permission?.status;
  const decided = status === 'granted' || status === 'denied';
  return (
    <OnboardingFrame
      top={top}
      art={<Illustration icon={step === 'location' ? 'location' : 'notifications'} />}
      title={copy.title}
      body={status === 'granted' ? copy.granted : status === 'denied' ? copy.denied : copy.ask}
      actions={
        <>
          {banner}
          <Button
            label="Continue"
            accessibilityHint={
              decided
                ? undefined
                : step === 'location'
                  ? 'Shows the system location prompt'
                  : 'Shows the system notification prompt'
            }
            loading={busy}
            onPress={() => void act(continuePermission)}
          />
          {decided ? null : (
            <Button
              label="Not now"
              accessibilityHint={
                step === 'location'
                  ? 'Continues without location'
                  : 'Continues without notifications'
              }
              variant="link"
              disabled={busy}
              onPress={() => go(after(step))}
            />
          )}
          {status === 'denied' ? (
            <Button
              label="Open Settings"
              accessibilityHint={`Opens WTW in your phone’s Settings to turn on ${step}`}
              variant="link"
              disabled={busy}
              onPress={() => void act(openDeviceSettings)}
            />
          ) : null}
        </>
      }
    />
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, gap: space.md },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
