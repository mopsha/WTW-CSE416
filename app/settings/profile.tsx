import type { UserProfile } from '@shared/api/userProfiles.ts';
import { validateDisplayName } from '@shared/api/profile.ts';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput } from 'react-native';
import {
  Button,
  Card,
  ErrorState,
  Screen,
  colors,
  MIN_TARGET,
  radius,
  space,
  type,
} from '@/components';
import { OwnProfileDetails } from '@/components/OwnProfileDetails';
import { useProfile } from '@/hooks/useProfile';
import { useAction } from '@/hooks/useAction';
import { api } from '@/lib/api';
import { messageOf } from '@/lib/errors';
export default function EditProfileSettings() {
  const { section } = useLocalSearchParams<{ section?: string }>();
  const { displayName, saveDisplayName } = useProfile();
  const [name, setName] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);
  const action = useAction();
  const load = useCallback(async () => {
    const request = ++latest.current;
    try {
      const p = await api.getMyUserProfile();
      if (request === latest.current) {
        setProfile(p);
        setError(null);
      }
    } catch (e) {
      if (request === latest.current) setError(messageOf(e));
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      void load();
      return () => {
        latest.current++;
      };
    }, [load]),
  );
  const saveName = async () => {
    const validated = validateDisplayName(name ?? displayName ?? '');
    if ('error' in validated) {
      setError(validated.error);
      return;
    }
    if (await action.run('name', () => saveDisplayName(validated.name))) {
      setName(null);
      setError(null);
    }
  };
  return (
    <Screen title="Edit profile" back>
      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      {action.error ? <ErrorState message={action.error} /> : null}
      <Card>
        <Text style={s.text}>Display name</Text>
        <TextInput
          accessibilityLabel="Display name"
          style={s.input}
          value={name ?? displayName ?? ''}
          onChangeText={setName}
          editable={!action.busy}
          autoComplete="name"
        />
        <Button
          label="Save display name"
          variant="secondary"
          loading={action.busy === 'name'}
          onPress={() => void saveName()}
        />
      </Card>
      {profile ? (
        <OwnProfileDetails
          key={section ?? 'details'}
          profile={profile}
          onSaved={setProfile}
          initiallyOpen={section === 'privacy'}
        />
      ) : !error ? (
        <ActivityIndicator color={colors.primary} accessibilityLabel="Loading profile details" />
      ) : null}
    </Screen>
  );
}
const s = StyleSheet.create({
  text: { ...type.body, color: colors.text },
  input: {
    ...type.body,
    color: colors.text,
    backgroundColor: colors.cardHi,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.md,
    minHeight: MIN_TARGET,
  },
});
