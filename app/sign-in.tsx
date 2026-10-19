import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { ErrorBanner } from '@/components/ErrorBanner';
import { GradientButton } from '@/components/GradientButton';
import { colors, flame, fonts, MIN_TARGET } from '@/components/theme';
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
      if (isResend) setNotice('New code sent. Older codes no longer work.');
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
    <View style={styles.root}>
      <LinearGradient
        colors={['#3B0F24', colors.bg, colors.bg]}
        locations={[0, 0.55, 1]}
        style={StyleSheet.absoluteFill}
      />
      <SafeAreaView style={styles.flex}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <View style={styles.hero}>
              <LinearGradient
                colors={flame}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.logo}
              >
                <Text style={styles.logoText}>wtw</Text>
              </LinearGradient>
              <Text style={styles.brand} accessibilityRole="header">
                What&apos;s the Word?
              </Text>
              <Text style={styles.tagline}>Stop debating. Start deciding. 🔥</Text>
            </View>

            {USE_MOCK ? (
              <Text style={styles.mock}>Demo mode · any email · code {MOCK_CODE}</Text>
            ) : null}

            {step === 'email' ? (
              <View style={styles.form}>
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
                  accessibilityLabel="Email"
                />
                <GradientButton
                  label="Send me a code"
                  onPress={() => void sendCode(false)}
                  loading={busy}
                />
                <Text style={styles.fine}>No passwords. We email you a 6-digit code.</Text>
              </View>
            ) : (
              <View style={styles.form}>
                <Text style={styles.body}>
                  Enter the code we sent to{'\n'}
                  <Text style={styles.bold}>{trimmedEmail}</Text>
                </Text>
                <Pressable
                  onPress={() => codeInput.current?.focus()}
                  style={styles.boxes}
                  accessibilityLabel={`Code, ${code.length} of 6 digits entered`}
                >
                  {Array.from({ length: 6 }, (_, i) => {
                    const active = i === code.length && !busy;
                    return (
                      <View
                        key={i}
                        style={[
                          styles.box,
                          active && styles.boxActive,
                          !!code[i] && styles.boxFilled,
                        ]}
                      >
                        <Text style={styles.boxText}>{code[i] ?? ''}</Text>
                      </View>
                    );
                  })}
                </Pressable>
                <TextInput
                  ref={codeInput}
                  style={styles.hiddenInput}
                  value={code}
                  onChangeText={onCodeChange}
                  keyboardType="number-pad"
                  maxLength={6}
                  autoComplete="one-time-code"
                  textContentType="oneTimeCode"
                  accessibilityLabel="6-digit code"
                  editable={!busy}
                  autoFocus
                />
                <GradientButton
                  label="Let's go"
                  onPress={() => void verify()}
                  loading={busy}
                  disabled={code.length !== 6}
                />
                <View style={styles.row}>
                  <Button
                    label={cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
                    variant="link"
                    onPress={() => void sendCode(true)}
                    disabled={cooldown > 0 || busy}
                  />
                  <Button
                    label="Change email"
                    variant="link"
                    onPress={() => {
                      setStep('email');
                      setCode('');
                      setError(null);
                      setNotice(null);
                    }}
                  />
                </View>
              </View>
            )}

            {notice ? (
              <Text style={styles.fine} accessibilityLiveRegion="polite">
                {notice}
              </Text>
            ) : null}
            {error ? <ErrorBanner message={error} /> : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  content: { flexGrow: 1, justifyContent: 'center', padding: 24, gap: 22 },
  hero: { alignItems: 'center', gap: 10, marginBottom: 8 },
  logo: {
    width: 92,
    height: 92,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '-8deg' }],
    shadowColor: '#FF3D71',
    shadowOpacity: 0.6,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  logoText: { fontFamily: fonts.black, fontSize: 34, color: '#FFFFFF', letterSpacing: -1 },
  brand: { fontFamily: fonts.black, fontSize: 32, color: colors.text, marginTop: 12 },
  tagline: { fontFamily: fonts.medium, fontSize: 16, color: colors.muted },
  mock: {
    alignSelf: 'center',
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.muted,
    backgroundColor: colors.infoBg,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    overflow: 'hidden',
  },
  form: { gap: 14 },
  body: {
    fontFamily: fonts.medium,
    fontSize: 16,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 24,
  },
  bold: { fontFamily: fonts.bold, color: colors.text },
  input: {
    minHeight: MIN_TARGET + 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 22,
    fontFamily: fonts.medium,
    fontSize: 17,
    color: colors.text,
    backgroundColor: colors.card,
  },
  boxes: { flexDirection: 'row', justifyContent: 'center', gap: 10 },
  box: {
    width: 46,
    height: 58,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxActive: { borderColor: colors.primary },
  boxFilled: { borderColor: '#FF7A45', backgroundColor: colors.cardHi },
  boxText: { fontFamily: fonts.bold, fontSize: 26, color: colors.text },
  hiddenInput: { position: 'absolute', opacity: 0, height: 1, width: 1 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  fine: { fontFamily: fonts.medium, fontSize: 13, color: colors.muted, textAlign: 'center' },
});
