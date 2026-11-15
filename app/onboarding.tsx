import { parseProfileDetails } from '@shared/api/userProfiles.ts';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AppState, TextInput } from 'react-native';

import {
  Button,
  colors,
  ErrorState,
  Illustration,
  OnboardingFrame,
  onboardingStyles,
  PageDots,
} from '@/components';
import { useProfile } from '@/hooks/useProfile';
import { api } from '@/lib/api';
import { messageOf } from '@/lib/errors';
import {
  readLocationPermission,
  readNotificationPermission,
  requestLocationPermission,
  requestNotificationPermission,
  type PermissionInfo,
} from '@/lib/permissions';
import { registerForPush } from '@/lib/push';
import { openDeviceSettings } from '@/lib/settingsPermissions';

const STEPS = ['favorites', 'location', 'notifications', 'done'] as const;
type Step = (typeof STEPS)[number];
type PermissionStep = 'location' | 'notifications';

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

// Optional routes are part of the signed-in stack: neither permissions nor this offer gate Picks.
// Permission steps follow App Store guideline 5.1.1: our button says "Continue" and only that
// tap shows the system prompt; "Not now" moves on with no prompt; a decided permission is never
// asked again. Opening a step only reads the status.
export default function OnboardingScreen() {
  const { finishOptionalSetup } = useProfile();
  const [step, setStep] = useState<Step>('favorites');
  const [cuisine, setCuisine] = useState('');
  const [activity, setActivity] = useState('');
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

  function go(next: Step) {
    setPermission(null);
    setError(null);
    setStep(next);
    if (next === 'done') void markDone();
  }

  /** Records that setup was offered. Offline failures just mean it's offered again next start. */
  async function markDone() {
    if (finished.current) return;
    finished.current = true;
    try {
      await finishOptionalSetup();
    } catch {
      finished.current = false;
    }
  }

  function enter() {
    // Leave immediately; persisting the dismissal must not hold up entry when offline.
    router.replace('/');
    void markDone();
  }

  async function saveFavorites() {
    if (!cuisine.trim() && !activity.trim()) return go('location');
    const current = await api.getMyUserProfile();
    await api.updateProfileDetails(
      parseProfileDetails({
        username: current.username,
        shareMetadata: current.shareMetadata ?? false,
        favoriteCuisine: cuisine.trim() || current.favoriteCuisine,
        favoriteActivity: activity.trim() || current.favoriteActivity,
      }),
    );
    go('location');
  }

  async function continuePermission() {
    if (step === 'location') {
      await requestLocationPermission();
      go('notifications');
    } else {
      const result = await requestNotificationPermission();
      if (result.status === 'granted') void registerForPush();
      go('done');
    }
  }

  const index = STEPS.indexOf(step);
  const top =
    step === 'done' ? (
      <PageDots index={index} total={STEPS.length} noun="Step" />
    ) : (
      <>
        <PageDots index={index} total={STEPS.length} noun="Step" />
        <Button
          label="Skip setup"
          accessibilityHint="Skips the optional setup and opens your Picks"
          variant="link"
          disabled={busy}
          onPress={enter}
        />
      </>
    );
  const banner = error ? <ErrorState variant="banner" message={error} /> : null;

  if (step === 'favorites')
    return (
      <OnboardingFrame
        top={top}
        art={<Illustration icon="heart" size={160} />}
        title="A few favorites?"
        body="Optional. Add a cuisine and an activity you love to your profile."
        actions={
          <>
            {banner}
            <Button label="Continue" loading={busy} onPress={() => void act(saveFavorites)} />
            <Button
              label="Not now"
              accessibilityHint="Skips favorites"
              variant="link"
              disabled={busy}
              onPress={() => go('location')}
            />
          </>
        }
      >
        <TextInput
          style={onboardingStyles.input}
          value={cuisine}
          onChangeText={setCuisine}
          maxLength={60}
          placeholder="Favorite cuisine, e.g. Japanese"
          placeholderTextColor={colors.muted}
          accessibilityLabel="Favorite cuisine"
          editable={!busy}
        />
        <TextInput
          style={onboardingStyles.input}
          value={activity}
          onChangeText={setActivity}
          maxLength={60}
          placeholder="Favorite activity, e.g. Basketball"
          placeholderTextColor={colors.muted}
          accessibilityLabel="Favorite activity"
          editable={!busy}
        />
      </OnboardingFrame>
    );

  if (step === 'done')
    return (
      <OnboardingFrame
        top={top}
        art={
          <Illustration
            icon="flame"
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
              onPress={() => go(step === 'location' ? 'notifications' : 'done')}
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
