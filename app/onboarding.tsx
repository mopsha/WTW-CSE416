import { EMPTY_PREFERENCES, type Preferences } from '@shared/domain/preferences.ts';
import * as Location from 'expo-location';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  Button,
  colors,
  EmptyState,
  ErrorState,
  PreferencesForm,
  ProgressBar,
  Screen,
  space,
  type,
} from '@/components';
import { useAction } from '@/hooks/useAction';
import { useProfile } from '@/hooks/useProfile';
import { ensureNotificationPermission } from '@/lib/notify';
import { registerForPush } from '@/lib/push';

type Step = 'survey' | 'location' | 'notifications';
const STEPS: Step[] = ['survey', 'location', 'notifications'];

// First-run onboarding, after the name step: the preference survey (FR-02), then a location
// explainer and a notifications explainer shown BEFORE each system prompt. Every step can be
// skipped and saying no keeps the app fully usable (App Store 5.1.2). Saving at the end marks
// onboarding done, which flips the root layout's guard to the tabs.
export default function OnboardingScreen() {
  const { savePreferences } = useProfile();
  const [step, setStep] = useState<Step>('survey');
  const [answers, setAnswers] = useState<Preferences>(EMPTY_PREFERENCES);
  const { busy, error, run } = useAction();
  const index = STEPS.indexOf(step);

  async function finish() {
    await run('finish', () => savePreferences(answers));
  }

  async function allowLocation() {
    try {
      await Location.requestForegroundPermissionsAsync();
    } catch {
      // Location services off or unsupported: a dropped pin still works everywhere.
    }
    setStep('notifications');
  }

  async function allowNotifications() {
    if (await ensureNotificationPermission()) void registerForPush();
    await finish();
  }

  const progress = (
    <ProgressBar
      value={index + 1}
      total={STEPS.length}
      showCount={false}
      accessibilityLabel="setup steps"
    />
  );

  if (step === 'survey') {
    return (
      <Screen
        title="What are you into?"
        subtitle={`Step ${index + 1} of ${STEPS.length}`}
        edges={['top', 'left', 'right', 'bottom']}
      >
        {progress}
        <Text style={styles.lede}>
          This shapes Discover and your Pick suggestions. Only you can see it.
        </Text>
        <PreferencesForm value={answers} onChange={setAnswers} />
        <Button label="Next" onPress={() => setStep('location')} />
        <Button
          label="Skip for now"
          variant="link"
          accessibilityHint="Skips the questions; you can answer them later on the Profile tab"
          onPress={() => {
            setAnswers(EMPTY_PREFERENCES);
            setStep('location');
          }}
        />
      </Screen>
    );
  }

  const location = step === 'location';
  return (
    <Screen subtitle={`Step ${index + 1} of ${STEPS.length}`}>
      {progress}
      <View style={styles.explainer}>
        {location ? (
          <EmptyState
            emoji="📍"
            title="Find places near you"
            body="WTW uses your location only while the app is open, to center a Pick where you are and show what's nearby in Discover. You can always drop a pin instead."
          />
        ) : (
          <EmptyState
            emoji="🔔"
            title="Know when your group is ready"
            body="We'll tell you when a Pick starts, when it's time to vote, and when there's a winner. Notifications never show anyone's answers."
          />
        )}
      </View>
      {error ? <ErrorState message={error} /> : null}
      <Button
        label={location ? 'Allow location' : 'Turn on notifications'}
        icon={location ? 'location-outline' : 'notifications-outline'}
        loading={busy === 'finish'}
        onPress={() => void (location ? allowLocation() : allowNotifications())}
        accessibilityHint="Shows your phone's permission prompt"
      />
      <Button
        label="Not now"
        variant="link"
        disabled={!!busy}
        onPress={() => (location ? setStep('notifications') : void finish())}
        accessibilityHint="You can turn this on later in Settings"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  lede: { ...type.body, color: colors.muted },
  // Scrolls rather than clips at large text sizes.
  explainer: { paddingVertical: space.xxl },
});
