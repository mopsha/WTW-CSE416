import type { Birthday } from '@shared/api/birthdays.ts';
import { BirthdayField } from '@/components/BirthdayField';
import { parseIdentity } from '@shared/api/userProfiles.ts';
import { validateDisplayName, DISPLAY_NAME_MAX } from '@shared/api/profile.ts';
import { useRef, useState } from 'react';
import { StyleSheet, Text, TextInput } from 'react-native';

import {
  Avatar,
  Button,
  colors,
  ErrorState,
  OnboardingFrame,
  onboardingStyles,
  type,
} from '@/components';
import { useAction } from '@/hooks/useAction';
import { useSession } from '@/hooks/useAuth';
import { suggestedName, useProfile } from '@/hooks/useProfile';
import { auth } from '@/lib/auth';

// Required identity setup for new accounts and legacy profiles missing a name or username.
// RootStack handles profile lookup failures before mounting this route.
export default function WelcomeScreen() {
  const session = useSession();
  return <WelcomeForm key={`${session.user.id}:${session.user.email ?? ''}`} />;
}
function WelcomeForm() {
  const session = useSession();
  const profile = useProfile();
  const [username, setUsername] = useState(profile.username ?? '');
  const [name, setName] = useState(() => profile.displayName ?? suggestedName(session.user.email));
  const [birthday, setBirthday] = useState<Birthday | null>(null);
  const [invalid, setInvalid] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  const pending = useRef(false);

  async function save(skipBirthday = false) {
    if (pending.current) return;
    const result = validateDisplayName(name);
    if ('error' in result) {
      setInvalid(result.error);
      return;
    }
    setInvalid(null);
    pending.current = true;
    try {
      await run('save', async () => {
        const input = parseIdentity({
          displayName: result.name,
          username,
          ...(birthday || skipBirthday ? { birthday: skipBirthday ? null : birthday } : {}),
        });
        if (birthday || skipBirthday)
          await profile.completeIdentity(input.displayName, input.username, input.birthday);
        else await profile.completeIdentity(input.displayName, input.username);
      });
    } finally {
      pending.current = false;
    }
  }

  const preview = name.trim() || '?';

  return (
    <OnboardingFrame
      art={<Avatar name={preview} size={120} />}
      title="What should we call you?"
      body="Your name and username show up in Picks. You can change them later."
      actions={
        <>
          {error ? <ErrorState variant="banner" message={error} /> : null}
          <Button
            label="Continue"
            accessibilityHint="Saves your name and username"
            onPress={() => void save()}
            loading={busy === 'save'}
            disabled={!name.trim() || !username.trim()}
          />
          <Button
            label="Skip birthday"
            accessibilityHint="Saves your name and username without a birthday."
            variant="link"
            disabled={!!busy || !name.trim() || !username.trim()}
            onPress={() => void save(true)}
          />
          <Button
            label="Use a different email"
            variant="link"
            onPress={() => void run('logout', () => auth.signOut())}
          />
        </>
      }
    >
      <TextInput
        style={onboardingStyles.input}
        value={name}
        onChangeText={(text) => {
          setName(text);
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
        accessibilityHint="Shown to people in your Picks"
        editable={!busy}
      />
      <TextInput
        style={onboardingStyles.input}
        value={username}
        onChangeText={setUsername}
        placeholder="Username"
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel="Username"
        accessibilityHint="3 to 24 letters, numbers or underscores"
        maxLength={25}
        editable={!busy}
      />
      <Text style={onboardingStyles.fine}>3–24 letters, numbers or underscores.</Text>
      <BirthdayField value={birthday} onChange={setBirthday} disabled={!!busy} />
      {invalid ? (
        <Text style={styles.invalid} accessibilityLiveRegion="polite">
          {invalid}
        </Text>
      ) : null}
    </OnboardingFrame>
  );
}

const styles = StyleSheet.create({
  invalid: { ...type.caption, color: colors.danger, textAlign: 'center' },
});
