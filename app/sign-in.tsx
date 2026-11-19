import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams } from 'expo-router';
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
import type { AuthMode } from '@/lib/authTypes';
import { auth, AuthError } from '@/lib/auth';
import { USE_MOCK } from '@/lib/config';
import { messageOf } from '@/lib/errors';
import { openLegalPage, PRIVACY_URL, TERMS_URL } from '@/lib/legal';
import { MOCK_CODE } from '@/lib/mock/auth';
import { appleSignInAvailable, googleSignInAvailable } from '@/lib/socialSignIn';

/** Supabase's default minimum interval between OTP emails to the same address. */
const RESEND_SECONDS = 60;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SignInScreen() {
  // The intro's "Get started" opens sign-up; "Log in" and every other entry open log-in.
  const params = useLocalSearchParams<{ mode?: string }>();
  const [mode, setMode] = useState<AuthMode>(params.mode === 'signup' ? 'signup' : 'login');
  // Log in: username or email + password, or an emailed code. Sign up: email -> code; the
  // welcome screen then asks for a name, username and password.
  const [step, setStep] = useState<'form' | 'code'>('form');
  const [loginWith, setLoginWith] = useState<'password' | 'code'>('password');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [apple, setApple] = useState(false);
  const google = googleSignInAvailable();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const pending = useRef(false);
  const codeInput = useRef<TextInput>(null);

  useEffect(() => {
    let active = true;
    void appleSignInAvailable().then((ok) => active && setApple(ok));
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const trimmedEmail = email.trim().toLowerCase();

  async function sendCode(isResend: boolean) {
    if (pending.current) return;
    setError(null);
    setNotice(null);
    if (!EMAIL_RE.test(trimmedEmail)) {
      setError('Enter a valid email address.');
      return;
    }
    pending.current = true;
    setBusy(true);
    try {
      await auth.sendCode(trimmedEmail, mode);
      setStep('code');
      setCode('');
      setCooldown(RESEND_SECONDS);
      if (isResend) setNotice('New code sent. Older codes no longer work.');
      setTimeout(() => codeInput.current?.focus(), 50);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  /** Go straight to the code boxes without sending an email. */
  function enterCode() {
    setError(null);
    setNotice(null);
    if (!EMAIL_RE.test(trimmedEmail)) {
      setError('Enter your email first, then your code.');
      return;
    }
    setStep('code');
    setCode('');
    setTimeout(() => codeInput.current?.focus(), 50);
  }

  async function verify(value = code) {
    if (value.length !== 6 || pending.current) return;
    setError(null);
    setNotice(null);
    pending.current = true;
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
      pending.current = false;
      setBusy(false);
    }
  }

  /** Runs one sign-in attempt; the root layout's auth guard then opens the app. */
  async function attempt(work: () => Promise<unknown>) {
    if (pending.current) return;
    setError(null);
    setNotice(null);
    pending.current = true;
    setBusy(true);
    try {
      await work();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  function signInWithPassword() {
    if (!identifier.trim() || !password) {
      setError('Enter your username or email and your password.');
      return;
    }
    void attempt(async () => {
      try {
        await auth.signInWithPassword(identifier, password);
      } catch (e) {
        setPassword('');
        throw e;
      }
    });
  }

  function switchMode(next: AuthMode) {
    setMode(next);
    setLoginWith('password');
    setError(null);
    setNotice(null);
  }

  function onCodeChange(text: string) {
    const digits = text.replace(/\D/g, '').slice(0, 6);
    setCode(digits);
    if (digits.length === 6) void verify(digits);
  }

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={[colors.card, colors.bg, colors.bg]}
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
              <Text style={styles.mock}>
                Demo · Log in as demo / password, or sign up · code {MOCK_CODE}
              </Text>
            ) : null}

            {step === 'form' ? (
              <View style={styles.form}>
                {apple || google ? (
                  <>
                    {apple ? (
                      <SocialButton
                        icon="logo-apple"
                        label="Continue with Apple"
                        disabled={busy}
                        onPress={() => void attempt(() => auth.signInWithApple())}
                      />
                    ) : null}
                    {google ? (
                      <SocialButton
                        icon="logo-google"
                        label="Continue with Google"
                        disabled={busy}
                        onPress={() => void attempt(() => auth.signInWithGoogle())}
                      />
                    ) : null}
                    <View style={styles.divider} accessibilityElementsHidden>
                      <View style={styles.line} />
                      <Text style={styles.fine}>or</Text>
                      <View style={styles.line} />
                    </View>
                  </>
                ) : null}
                <View style={styles.row}>
                  <Button
                    label="Log In"
                    variant={mode === 'login' ? 'secondary' : 'link'}
                    disabled={busy}
                    onPress={() => switchMode('login')}
                  />
                  <Button
                    label="Sign Up"
                    variant={mode === 'signup' ? 'secondary' : 'link'}
                    disabled={busy}
                    onPress={() => switchMode('signup')}
                  />
                </View>
                {mode === 'login' && loginWith === 'password' ? (
                  <>
                    <Text style={styles.body}>Welcome back</Text>
                    <TextInput
                      style={styles.input}
                      editable={!busy}
                      value={identifier}
                      onChangeText={setIdentifier}
                      placeholder="Username or email"
                      placeholderTextColor={colors.muted}
                      autoCapitalize="none"
                      autoCorrect={false}
                      autoComplete="username"
                      textContentType="username"
                      returnKeyType="next"
                      accessibilityLabel="Username or email"
                    />
                    <TextInput
                      style={styles.input}
                      editable={!busy}
                      value={password}
                      onChangeText={setPassword}
                      placeholder="Password"
                      placeholderTextColor={colors.muted}
                      secureTextEntry
                      autoCapitalize="none"
                      autoCorrect={false}
                      autoComplete="current-password"
                      textContentType="password"
                      returnKeyType="go"
                      onSubmitEditing={signInWithPassword}
                      accessibilityLabel="Password"
                    />
                    <GradientButton label="Log in" onPress={signInWithPassword} loading={busy} />
                    <Button
                      label="Forgot password? Email me a code"
                      variant="link"
                      accessibilityHint="Log in with a 6-digit code sent to your email instead"
                      disabled={busy}
                      onPress={() => {
                        setLoginWith('code');
                        if (identifier.includes('@')) setEmail(identifier.trim());
                        setError(null);
                      }}
                    />
                  </>
                ) : (
                  <>
                    <Text style={styles.body}>
                      {mode === 'login'
                        ? 'We’ll email you a login code'
                        : 'Create your WTW account'}
                    </Text>
                    <TextInput
                      style={styles.input}
                      editable={!busy}
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
                      label={mode === 'login' ? 'Email login code' : 'Continue'}
                      onPress={() => void sendCode(false)}
                      loading={busy}
                    />
                    <Text style={styles.fine}>
                      {mode === 'login'
                        ? 'We email you a 6-digit code.'
                        : 'We’ll email a 6-digit code to confirm it’s you. Then pick a username and password.'}
                    </Text>
                    {mode === 'login' ? (
                      <Button
                        label="Log in with a password instead"
                        variant="link"
                        disabled={busy}
                        onPress={() => {
                          setLoginWith('password');
                          setError(null);
                        }}
                      />
                    ) : null}
                    {/* For a code you got another way, or when sending just hit a limit. */}
                    <Button
                      label="I already have a code"
                      variant="link"
                      accessibilityHint="Skips sending an email and goes to the code boxes"
                      disabled={busy}
                      onPress={enterCode}
                    />
                  </>
                )}
                {mode === 'signup' ? (
                  <>
                    <Text style={styles.fine}>
                      By creating an account, you agree to the Terms of Use and confirm you’re at
                      least 13. The Privacy Policy explains how WTW uses your data.
                    </Text>
                    <View style={styles.legal}>
                      <Button
                        label="Terms of Use"
                        variant="link"
                        onPress={() => void openLegalPage(TERMS_URL, 'Terms of Use')}
                      />
                      <Button
                        label="Privacy Policy"
                        variant="link"
                        onPress={() => void openLegalPage(PRIVACY_URL, 'Privacy Policy')}
                      />
                    </View>
                  </>
                ) : null}
              </View>
            ) : (
              <View style={styles.form}>
                <Text style={styles.body}>
                  Enter the code we sent to{'\n'}
                  <Text style={styles.bold}>{trimmedEmail}</Text>
                </Text>
                <View style={styles.codeEntry}>
                  <View
                    style={styles.boxes}
                    accessible={false}
                    importantForAccessibility="no-hide-descendants"
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
                  </View>
                  <TextInput
                    ref={codeInput}
                    style={styles.hiddenInput}
                    value={code}
                    onChangeText={onCodeChange}
                    keyboardType="number-pad"
                    {...(Platform.OS === 'ios'
                      ? { textContentType: 'oneTimeCode' as const }
                      : { autoComplete: 'one-time-code' as const })}
                    accessibilityLabel="6-digit code"
                    accessibilityHint="Enter or paste the code from your email"
                    editable={!busy}
                    autoFocus
                    caretHidden
                  />
                </View>
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
                    disabled={busy}
                    label="Change email"
                    variant="link"
                    onPress={() => {
                      setStep('form');
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

/** Apple's guidelines allow a white button with its logo and "Continue with Apple" on dark UI. */
function SocialButton({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: 'logo-apple' | 'logo-google';
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [styles.social, (pressed || disabled) && { opacity: 0.7 }]}
    >
      <Ionicons name={icon} size={20} color={colors.bg} />
      <Text style={styles.socialText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  social: {
    minHeight: MIN_TARGET + 8,
    borderRadius: 999,
    backgroundColor: colors.text,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  socialText: { fontFamily: fonts.bold, fontSize: 17, color: colors.bg },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  line: { flex: 1, height: 1, backgroundColor: colors.border },
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
  boxes: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
  box: {
    flex: 1,
    maxWidth: 46,
    minWidth: 0,
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
  codeEntry: { position: 'relative' },
  hiddenInput: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    color: colors.transparent,
    backgroundColor: colors.transparent,
    fontSize: 26,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  fine: { fontFamily: fonts.medium, fontSize: 13, color: colors.muted, textAlign: 'center' },
  legal: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' },
});
