import { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { ErrorBanner } from '@/components/ErrorBanner';
import { colors, MIN_TARGET } from '@/components/theme';
import { auth, AuthError } from '@/lib/auth';
import { USE_MOCK } from '@/lib/config';
import { messageOf } from '@/lib/errors';
import { MOCK_CODE } from '@/lib/mock/auth';

/** Supabase's default minimum interval between OTP emails to the same address. */
const RESEND_SECONDS = 60;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SignInScreen() {
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const codeInput = useRef<TextInput>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const trimmedEmail = email.trim().toLowerCase();

  async function sendCode(isResend: boolean) {
    setError(null);
    setNotice(null);
    if (!EMAIL_RE.test(trimmedEmail)) {
      setError('Enter a valid email address.');
      return;
    }
    setBusy(true);
    try {
      await auth.sendCode(trimmedEmail);
      setStep('code');
      setCode('');
      setCooldown(RESEND_SECONDS);
      if (isResend) setNotice('We sent a new code. Older codes no longer work.');
      setTimeout(() => codeInput.current?.focus(), 50);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  async function verify(value = code) {
    if (value.length !== 6 || busy) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await auth.verifyCode(trimmedEmail, value);
      // The root layout's auth guard switches to the signed-in stack.
    } catch (e) {
      setError(
        e instanceof AuthError && e.code === 'invalid_code'
          ? 'That code is wrong or has expired. Check the latest email, or resend a new code.'
          : messageOf(e),
      );
      setCode('');
      codeInput.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  function onCodeChange(text: string) {
    const digits = text.replace(/\D/g, '').slice(0, 6);
    setCode(digits);
    if (digits.length === 6) void verify(digits);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.brand} accessibilityRole="header">
            WTW
          </Text>
          <Text style={styles.tagline}>What&apos;s the Word? Stop debating. Start deciding.</Text>

          {USE_MOCK ? (
            <Text style={styles.mock}>
              Mock mode: any email works, and the code is {MOCK_CODE}.
            </Text>
          ) : null}

          {step === 'email' ? (
            <View style={styles.form}>
              <Text style={styles.label} nativeID="emailLabel">
                Email
              </Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="you@stonybrook.edu"
                placeholderTextColor={colors.muted}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                textContentType="emailAddress"
                returnKeyType="send"
                onSubmitEditing={() => void sendCode(false)}
                accessibilityLabelledBy="emailLabel"
                accessibilityLabel="Email"
              />
              <Button label="Send code" onPress={() => void sendCode(false)} loading={busy} />
            </View>
          ) : (
            <View style={styles.form}>
              <Text style={styles.body}>
                Enter the 6-digit code we sent to <Text style={styles.bold}>{trimmedEmail}</Text>.
              </Text>
              <TextInput
                ref={codeInput}
                style={[styles.input, styles.codeInput]}
                value={code}
                onChangeText={onCodeChange}
                placeholder="000000"
                placeholderTextColor={colors.border}
                keyboardType="number-pad"
                maxLength={6}
                autoComplete="one-time-code"
                textContentType="oneTimeCode"
                accessibilityLabel="6-digit code"
                editable={!busy}
              />
              <Button
                label="Verify"
                onPress={() => void verify()}
                loading={busy}
                disabled={code.length !== 6}
              />
              <Button
                label={cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
                variant="secondary"
                onPress={() => void sendCode(true)}
                disabled={cooldown > 0 || busy}
              />
              <Button
                label="Use a different email"
                variant="link"
                onPress={() => {
                  setStep('email');
                  setCode('');
                  setError(null);
                  setNotice(null);
                }}
              />
            </View>
          )}

          {notice ? (
            <Text style={styles.notice} accessibilityLiveRegion="polite">
              {notice}
            </Text>
          ) : null}
          {error ? <ErrorBanner message={error} /> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  content: { flexGrow: 1, justifyContent: 'center', padding: 24, gap: 16 },
  brand: { fontSize: 44, fontWeight: '800', color: colors.primary },
  tagline: { fontSize: 17, color: colors.muted },
  mock: {
    padding: 12,
    borderRadius: 10,
    backgroundColor: colors.infoBg,
    color: colors.text,
    fontSize: 15,
  },
  form: { gap: 12 },
  label: { fontSize: 15, fontWeight: '600', color: colors.text },
  body: { fontSize: 16, color: colors.text },
  bold: { fontWeight: '700' },
  input: {
    minHeight: MIN_TARGET,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    fontSize: 17,
    color: colors.text,
    backgroundColor: colors.card,
  },
  codeInput: { fontSize: 28, letterSpacing: 8, textAlign: 'center', minHeight: 60 },
  notice: { fontSize: 15, color: colors.muted },
});
