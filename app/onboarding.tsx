import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { parseProfileDetails } from '@shared/api/userProfiles.ts';
import {
  Button,
  colors,
  EmptyState,
  ErrorState,
  MIN_TARGET,
  radius,
  Screen,
  space,
  type,
} from '@/components';
import { useProfile } from '@/hooks/useProfile';
import { api } from '@/lib/api';
import { messageOf } from '@/lib/errors';
import { ensureNotificationPermission } from '@/lib/notify';
import { registerForPush } from '@/lib/push';

// Optional routes are part of the signed-in stack: neither permissions nor this offer gate Picks.
export default function OnboardingScreen() {
  const { finishOptionalSetup } = useProfile();
  const [step, setStep] = useState<'favorites' | 'location' | 'notifications'>('favorites');
  const [cuisine, setCuisine] = useState('');
  const [activity, setActivity] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
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
  async function finish() {
    // Leave immediately; persisting the dismissal must not hold up entry when offline.
    router.replace('/');
    try {
      await finishOptionalSetup();
    } catch {
      /* Offered again on next start if unavailable. */
    }
  }
  async function favorites() {
    const current = await api.getMyUserProfile();
    await api.updateProfileDetails(
      parseProfileDetails({
        username: current.username,
        shareMetadata: current.shareMetadata ?? false,
        favoriteCuisine: cuisine.trim() || current.favoriteCuisine,
        favoriteActivity: activity.trim() || current.favoriteActivity,
      }),
    );
    setStep('location');
  }
  async function permission() {
    if (step === 'location') {
      try {
        await Location.requestForegroundPermissionsAsync();
      } catch {
        /* A pin still works. */
      }
      setStep('notifications');
    } else {
      try {
        if (await ensureNotificationPermission()) void registerForPush();
      } catch {
        /* Unsupported/denied permissions never block entry. */
      }
      await finish();
    }
  }
  const location = step === 'location';
  return (
    <Screen
      title={step === 'favorites' ? 'A few favorites?' : 'Make WTW work for you'}
      subtitle="Optional · you can change these in Settings"
    >
      {error ? <ErrorState variant="banner" message={error} /> : null}
      {step === 'favorites' ? (
        <>
          <Text style={s.body}>
            Add a favorite cuisine and activity to your profile. Your current privacy setting stays
            the same; new profiles keep metadata private.
          </Text>
          <TextInput
            style={s.input}
            value={cuisine}
            onChangeText={setCuisine}
            maxLength={60}
            placeholder="Favorite cuisine, e.g. Japanese"
            placeholderTextColor={colors.muted}
            accessibilityLabel="Favorite cuisine"
            editable={!busy}
          />
          <TextInput
            style={s.input}
            value={activity}
            onChangeText={setActivity}
            maxLength={60}
            placeholder="Favorite activity, e.g. Basketball"
            placeholderTextColor={colors.muted}
            accessibilityLabel="Favorite activity"
            editable={!busy}
          />
          <Button label="Save & continue" loading={busy} onPress={() => void act(favorites)} />
          <Button
            label="Skip favorites"
            variant="secondary"
            disabled={busy}
            onPress={() => setStep('location')}
          />
        </>
      ) : (
        <>
          <View style={{ paddingVertical: space.xl }}>
            <EmptyState
              emoji={location ? '📍' : '🔔'}
              title={location ? 'Find places near you' : 'Know when your group is ready'}
              body={
                location
                  ? 'WTW uses location while the app is open to find nearby places. You can drop a pin instead, and manage permission in Settings.'
                  : 'Get Pick updates when your group starts, votes or has a winner. Permission is optional and can be managed in Settings.'
              }
            />
          </View>
          <Button
            label={location ? 'Allow location' : 'Turn on notifications'}
            loading={busy}
            onPress={() => void act(permission)}
          />
          <Button
            label="Not now"
            variant="secondary"
            disabled={busy}
            onPress={() => (location ? setStep('notifications') : void act(finish))}
          />
        </>
      )}
      <Button
        label="Skip setup & enter WTW"
        variant="link"
        disabled={busy}
        onPress={() => void act(finish)}
      />
    </Screen>
  );
}
const s = StyleSheet.create({
  body: { ...type.body, color: colors.muted },
  input: {
    ...type.body,
    color: colors.text,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.md,
    minHeight: MIN_TARGET,
  },
});
