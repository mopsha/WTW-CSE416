import type { Preferences } from '@shared/domain/preferences.ts';
import { router } from 'expo-router';
import { useState } from 'react';

import { Button, ErrorState, PreferencesForm, Screen } from '@/components';
import { useAction } from '@/hooks/useAction';
import { useProfile } from '@/hooks/useProfile';

// "Edit preferences" from the Profile tab: the onboarding survey, prefilled with my answers.
export default function PreferencesScreen() {
  const profile = useProfile();
  const [answers, setAnswers] = useState<Preferences>(profile.preferences);
  const { busy, error, run } = useAction();

  async function save() {
    if (await run('save', () => profile.savePreferences(answers))) router.back();
  }

  return (
    <Screen title="Your preferences" subtitle="Only you can see these" back>
      <PreferencesForm value={answers} onChange={setAnswers} />
      {error ? <ErrorState message={error} /> : null}
      <Button label="Save" onPress={() => void save()} loading={busy === 'save'} />
    </Screen>
  );
}
