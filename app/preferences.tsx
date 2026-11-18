import type { LearnedTaste } from '@shared/api/profile.ts';
import type { Preferences } from '@shared/domain/preferences.ts';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import {
  Button,
  Card,
  colors,
  ErrorState,
  fonts,
  PreferencesForm,
  Screen,
  space,
  type,
} from '@/components';
import { useAction } from '@/hooks/useAction';
import { useProfile } from '@/hooks/useProfile';
import { api } from '@/lib/api';
import { tasteLabel } from '@/lib/tasteDeck';

/** At most this many learned types per line, strongest first. */
const SHOWN = 4;

// "Edit preferences" from the Profile tab or Settings: the onboarding survey, prefilled with my
// answers, plus what WTW learned from my Picks (with a reset) and a way to swipe again.
export default function PreferencesScreen() {
  const profile = useProfile();
  const [answers, setAnswers] = useState<Preferences>(profile.preferences);
  const [learned, setLearned] = useState<LearnedTaste[] | null>(null);
  const { busy, error, run } = useAction();

  useEffect(() => {
    let active = true;
    // Optional extra: if it can't load, the section just stays hidden.
    api
      .getLearnedTaste()
      .then((r) => active && setLearned(r.learned))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  async function save() {
    if (await run('save', () => profile.savePreferences(answers))) router.back();
  }

  async function reset() {
    if (await run('reset', () => api.resetLearnedTaste())) setLearned([]);
  }

  // Only what my own answers don't already say.
  const said = new Set([...answers.types, ...answers.dislikedTypes]);
  const fresh = (learned ?? []).filter((l) => !said.has(l.type));
  const likes = fresh.filter((l) => l.score > 0).slice(0, SHOWN);
  const skips = fresh
    .filter((l) => l.score < 0)
    .reverse()
    .slice(0, SHOWN);
  const names = (list: LearnedTaste[]) => list.map((l) => tasteLabel(l.type)).join(', ');

  return (
    <Screen title="Your preferences" subtitle="Only you can see these" back>
      <PreferencesForm value={answers} onChange={setAnswers} />
      {learned?.length ? (
        <Card>
          <Text style={styles.title} accessibilityRole="header">
            What WTW noticed
          </Text>
          <Text style={styles.hint}>
            From your swipes, votes and winners. Your answers above always come first.
          </Text>
          {likes.length ? <Text style={styles.line}>You seem to like {names(likes)}.</Text> : null}
          {skips.length ? (
            <Text style={styles.line}>You tend to pass on {names(skips)}.</Text>
          ) : null}
          {!likes.length && !skips.length ? (
            <Text style={styles.line}>Nothing new beyond your answers yet.</Text>
          ) : null}
          <Button
            label="Reset what WTW learned"
            accessibilityHint="Clears what WTW learned from your Picks. Your answers stay."
            variant="link"
            loading={busy === 'reset'}
            onPress={() => void reset()}
          />
        </Card>
      ) : null}
      <Button
        label="Swipe again"
        accessibilityHint="Swipe a few spots to update your answers"
        variant="secondary"
        icon="albums-outline"
        loading={busy === 'swipe'}
        // Save my edits first (the swipe starts from saved answers), then replace this screen
        // so finishing the swipe returns to Profile/Settings, not a stale form.
        onPress={() =>
          void run('swipe', () => profile.savePreferences(answers)).then(
            (ok) => ok && router.replace({ pathname: '/onboarding', params: { mode: 'taste' } }),
          )
        }
      />
      {error ? <ErrorState message={error} /> : null}
      <Button label="Save" onPress={() => void save()} loading={busy === 'save'} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontFamily: fonts.bold, fontSize: 17, color: colors.text },
  hint: { ...type.caption, color: colors.muted, marginTop: -space.xs },
  line: { ...type.body, color: colors.text },
});
