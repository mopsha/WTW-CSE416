// Settings → Password: set or change the password used to log in with a username or email.
// For everyone who signed up with an emailed code before passwords existed, and anyone who
// forgot theirs (log in with an emailed code, then come here). If the project requires a recent
// proof for password changes, Supabase emails a code first and this screen asks for it.
import { router } from 'expo-router';
import { useState } from 'react';
import { Text, TextInput } from 'react-native';

import { Button, colors, ErrorState, onboardingStyles, Screen } from '@/components';
import { useAction } from '@/hooks/useAction';
import { useSession } from '@/hooks/useAuth';
import { auth, AuthError } from '@/lib/auth';

const MIN_PASSWORD = 8;

export default function PasswordScreen() {
  // A different account starts a fresh form; a save already in flight is refused by auth.
  const { user } = useSession();
  return <PasswordForm key={user.id} userId={user.id} />;
}

function PasswordForm({ userId }: { userId: string }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  // Shown once Supabase asks for a code to confirm the change.
  const [needsCode, setNeedsCode] = useState(false);
  const [code, setCode] = useState('');
  const [done, setDone] = useState(false);
  const { busy, error, run } = useAction();

  const mismatch = confirm.length > 0 && confirm !== password;
  const ready =
    password.length >= MIN_PASSWORD &&
    confirm === password &&
    (!needsCode || code.trim().length >= 6);

  async function save() {
    if (!ready) return;
    // run() reports only "didn't throw"; whether it was actually saved is tracked here.
    let saved = false;
    await run('save', async () => {
      try {
        await auth.setPassword(password, { userId, code: needsCode ? code.trim() : undefined });
        saved = true;
      } catch (e) {
        if (e instanceof AuthError && e.code === 'reauth_needed' && !needsCode) {
          await auth.requestPasswordCode(userId);
          setNeedsCode(true);
          return;
        }
        throw e;
      }
    });
    if (saved) setDone(true);
  }

  if (done)
    return (
      <Screen title="Password" back>
        <Text style={onboardingStyles.fine}>
          Saved. You can now log in with your username or email and this password.
        </Text>
        <Button label="Done" onPress={() => router.back()} />
      </Screen>
    );

  return (
    <Screen title="Password" subtitle="Log in with your username or email and this password." back>
      <TextInput
        style={onboardingStyles.input}
        value={password}
        onChangeText={setPassword}
        placeholder="New password"
        placeholderTextColor={colors.muted}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="new-password"
        textContentType="newPassword"
        passwordRules={`minlength: ${MIN_PASSWORD};`}
        accessibilityLabel="New password"
        accessibilityHint={`At least ${MIN_PASSWORD} characters`}
        editable={!busy}
      />
      <TextInput
        style={onboardingStyles.input}
        value={confirm}
        onChangeText={setConfirm}
        placeholder="Type it again"
        placeholderTextColor={colors.muted}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="new-password"
        textContentType="newPassword"
        accessibilityLabel="Confirm new password"
        editable={!busy}
      />
      <Text style={onboardingStyles.fine} accessibilityLiveRegion="polite">
        {mismatch ? 'The passwords don’t match.' : `At least ${MIN_PASSWORD} characters.`}
      </Text>
      {needsCode ? (
        <>
          <Text style={onboardingStyles.fine} accessibilityLiveRegion="polite">
            To keep your account safe, we emailed you a code. Enter it to save.
          </Text>
          <TextInput
            style={onboardingStyles.input}
            value={code}
            onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 10))}
            placeholder="Code from your email"
            placeholderTextColor={colors.muted}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            accessibilityLabel="Code from your email"
            editable={!busy}
          />
          <Button
            label="Email me a new code"
            variant="link"
            disabled={!!busy}
            onPress={() => void run('code', () => auth.requestPasswordCode(userId))}
          />
        </>
      ) : null}
      {error ? <ErrorState variant="banner" message={error} /> : null}
      <Button
        label="Save password"
        onPress={() => void save()}
        loading={busy === 'save'}
        disabled={!ready}
      />
    </Screen>
  );
}
