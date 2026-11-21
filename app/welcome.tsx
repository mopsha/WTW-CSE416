import type { Birthday } from '@shared/api/birthdays.ts';
import { suggestUsername } from '@shared/api/signIn.ts';
import { BirthdayField } from '@/components/BirthdayField';
import { parseIdentity } from '@shared/api/userProfiles.ts';
import { validateDisplayName, DISPLAY_NAME_MAX } from '@shared/api/profile.ts';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput } from 'react-native';

import {
  Avatar,
  Button,
  colors,
  ErrorState,
  fonts,
  OnboardingFrame,
  onboardingStyles,
  type,
} from '@/components';
import { useAction } from '@/hooks/useAction';
import { useSession } from '@/hooks/useAuth';
import { suggestedName, useProfile } from '@/hooks/useProfile';
import { api } from '@/lib/api';
import { auth } from '@/lib/auth';

const MIN_PASSWORD = 8;

type Check =
  | { state: 'idle' | 'checking' }
  | { state: 'available' }
  | { state: 'taken'; suggestion?: string }
  | { state: 'invalid'; reason: string };

// Required identity setup for new accounts and legacy profiles missing a name or username.
// RootStack handles profile lookup failures before mounting this route.
export default function WelcomeScreen() {
  const session = useSession();
  return <WelcomeForm key={`${session.user.id}:${session.user.email ?? ''}`} />;
}
function WelcomeForm() {
  const session = useSession();
  const profile = useProfile();
  const [name, setName] = useState(
    () => profile.displayName ?? session.user.name ?? suggestedName(session.user.email),
  );
  // Suggested from the name until the user types their own (docs/sign-in.md).
  const [username, setUsername] = useState(
    () => profile.username ?? suggestUsername(profile.displayName ?? session.user.name ?? '') ?? '',
  );
  const usernameTouched = useRef(!!profile.username);
  const [check, setCheck] = useState<Check>({ state: 'idle' });
  // Email sign-ups pick a password here so they can log in with their username later.
  // Apple and Google accounts don't need one.
  const needsPassword = !session.user.provider || session.user.provider === 'email';
  const [password, setPassword] = useState('');
  const [birthday, setBirthday] = useState<Birthday | null>(null);
  const [invalid, setInvalid] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  const pending = useRef(false);

  // Live availability, a moment after typing stops.
  useEffect(() => {
    const wanted = username.trim();
    let active = true;
    const t = setTimeout(
      () => {
        if (wanted.length < 3) return active && setCheck({ state: 'idle' });
        setCheck({ state: 'checking' });
        api
          .usernameAvailable(wanted)
          .then((r) => {
            if (!active) return;
            if (r.available) setCheck({ state: 'available' });
            else if (r.reason) setCheck({ state: 'invalid', reason: r.reason });
            else setCheck({ state: 'taken', suggestion: r.suggestion });
          })
          // Offline or an older server: saving still checks for real.
          .catch(() => active && setCheck({ state: 'idle' }));
      },
      wanted.length < 3 ? 0 : 400,
    );
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [username]);

  function changeName(text: string) {
    setName(text);
    setInvalid(null);
    if (!usernameTouched.current) setUsername(suggestUsername(text) ?? '');
  }

  async function save(skipBirthday = false) {
    if (pending.current) return;
    const result = validateDisplayName(name);
    if ('error' in result) {
      setInvalid(result.error);
      return;
    }
    if (needsPassword && password.length < MIN_PASSWORD) {
      setInvalid(`Pick a password with at least ${MIN_PASSWORD} characters.`);
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
        // Password first: finishing the profile leaves this screen for good.
        if (needsPassword) await auth.setPassword(password, { userId: session.user.id });
        if (birthday || skipBirthday)
          await profile.completeIdentity(input.displayName, input.username, input.birthday);
        else await profile.completeIdentity(input.displayName, input.username);
      });
    } finally {
      pending.current = false;
    }
  }

  const preview = name.trim() || '?';
  const blocked =
    !name.trim() ||
    !username.trim() ||
    check.state === 'taken' ||
    check.state === 'invalid' ||
    (needsPassword && password.length < MIN_PASSWORD);

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
            accessibilityHint="Saves your name, username and password"
            onPress={() => void save()}
            loading={busy === 'save'}
            disabled={blocked}
          />
          <Button
            label="Skip birthday"
            accessibilityHint="Saves your name and username without a birthday."
            variant="link"
            disabled={!!busy || blocked}
            onPress={() => void save(true)}
          />
          <Button
            label="Use a different account"
            variant="link"
            onPress={() => void run('logout', () => auth.signOut())}
          />
        </>
      }
    >
      <TextInput
        style={onboardingStyles.input}
        value={name}
        onChangeText={changeName}
        placeholder="Your name"
        placeholderTextColor={colors.muted}
        autoCapitalize="words"
        autoComplete="name"
        textContentType="name"
        maxLength={DISPLAY_NAME_MAX * 2}
        returnKeyType="next"
        accessibilityLabel="Your name"
        accessibilityHint="Shown to people in your Picks"
        editable={!busy}
      />
      <TextInput
        style={onboardingStyles.input}
        value={username}
        onChangeText={(text) => {
          usernameTouched.current = true;
          setUsername(text.replace(/^@/, '').toLowerCase());
        }}
        placeholder="Username"
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="username-new"
        textContentType="username"
        accessibilityLabel="Username"
        accessibilityHint="3 to 24 letters, numbers or underscores, starting with a letter"
        maxLength={25}
        editable={!busy}
      />
      <UsernameStatus
        check={check}
        username={username.trim()}
        onUse={(s) => {
          usernameTouched.current = true;
          setUsername(s);
        }}
      />
      {needsPassword ? (
        <>
          <TextInput
            style={onboardingStyles.input}
            value={password}
            onChangeText={(text) => {
              setPassword(text);
              setInvalid(null);
            }}
            placeholder="Password"
            placeholderTextColor={colors.muted}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="new-password"
            textContentType="newPassword"
            passwordRules={`minlength: ${MIN_PASSWORD};`}
            accessibilityLabel="Password"
            accessibilityHint={`At least ${MIN_PASSWORD} characters. Log in with your username and this password.`}
            editable={!busy}
          />
          <Text style={onboardingStyles.fine}>
            Log in later with your username and this password.
          </Text>
        </>
      ) : null}
      <BirthdayField value={birthday} onChange={setBirthday} disabled={!!busy} />
      {invalid ? (
        <Text style={styles.invalid} accessibilityLiveRegion="polite">
          {invalid}
        </Text>
      ) : null}
    </OnboardingFrame>
  );
}

function UsernameStatus({
  check,
  username,
  onUse,
}: {
  check: Check;
  username: string;
  onUse: (suggestion: string) => void;
}) {
  if (check.state === 'available')
    return (
      <Text style={[styles.status, styles.ok]} accessibilityLiveRegion="polite">
        ✓ @{username} is available
      </Text>
    );
  if (check.state === 'invalid')
    return (
      <Text style={[styles.status, styles.bad]} accessibilityLiveRegion="polite">
        {check.reason}
      </Text>
    );
  if (check.state === 'taken')
    return check.suggestion ? (
      <Pressable
        onPress={() => onUse(check.suggestion!)}
        accessibilityRole="button"
        accessibilityLabel={`@${username} is taken. Use @${check.suggestion} instead`}
        style={styles.suggestion}
      >
        <Text style={[styles.status, styles.bad]}>
          @{username} is taken. <Text style={styles.use}>Use @{check.suggestion}</Text>
        </Text>
      </Pressable>
    ) : (
      <Text style={[styles.status, styles.bad]} accessibilityLiveRegion="polite">
        @{username} is taken.
      </Text>
    );
  return (
    <Text style={onboardingStyles.fine}>
      {check.state === 'checking'
        ? 'Checking…'
        : '3–24 letters, numbers or underscores, starting with a letter.'}
    </Text>
  );
}

const styles = StyleSheet.create({
  invalid: { ...type.caption, color: colors.danger, textAlign: 'center' },
  status: { ...type.caption, textAlign: 'center' },
  ok: { color: colors.yes },
  bad: { color: colors.danger },
  use: { fontFamily: fonts.bold, color: colors.primary },
  suggestion: { minHeight: 44, justifyContent: 'center' },
});
