import { validateDisplayName, DISPLAY_NAME_MAX } from '@shared/api/profile.ts';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
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

import { Avatar, Button, colors, ErrorState, fonts, MIN_TARGET } from '@/components';
import { GradientButton } from '@/components/GradientButton';
import { useAction } from '@/hooks/useAction';
import { useSession } from '@/hooks/useAuth';
import { suggestedName, useProfile } from '@/hooks/useProfile';
import { auth } from '@/lib/auth';

// "What should we call you?": shown once, right after the first sign-in, while my profile has
// no display_name. Saving flips the root layout's guard to the signed-in tabs.
export default function WelcomeScreen() {
  const session = useSession();
  const { saveDisplayName } = useProfile();
  const [name, setName] = useState(() => suggestedName(session.user.email));
  const [invalid, setInvalid] = useState<string | null>(null);
  const { busy, error, run } = useAction();

  async function save() {
    const result = validateDisplayName(name);
    if ('error' in result) {
      setInvalid(result.error);
      return;
    }
    setInvalid(null);
    await run('save', () => saveDisplayName(result.name));
  }

  const preview = name.trim() || '?';

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
              <Avatar name={preview} size={88} />
              <Text style={styles.title} accessibilityRole="header">
                What should we call you?
              </Text>
              <Text style={styles.body}>
                Your friends see this in the Lobby, the Waiting room and the final vote.
              </Text>
            </View>
            <View style={styles.form}>
              <TextInput
                style={styles.input}
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
                autoFocus
                maxLength={DISPLAY_NAME_MAX * 2}
                returnKeyType="done"
                onSubmitEditing={() => void save()}
                accessibilityLabel="Your name"
                accessibilityHint="Shown to people in your Picks"
                editable={!busy}
              />
              {invalid ? (
                <Text style={styles.invalid} accessibilityLiveRegion="polite">
                  {invalid}
                </Text>
              ) : null}
              <GradientButton
                label="Save"
                onPress={() => void save()}
                loading={busy === 'save'}
                disabled={!name.trim()}
              />
              <Text style={styles.fine}>You can change it any time on the Profile tab.</Text>
              <Button
                label="Use a different email"
                variant="link"
                onPress={() => void auth.signOut()}
              />
            </View>
            {error ? <ErrorState variant="banner" message={error} /> : null}
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
  hero: { alignItems: 'center', gap: 12 },
  title: {
    fontFamily: fonts.black,
    fontSize: 28,
    color: colors.text,
    textAlign: 'center',
    marginTop: 8,
  },
  body: {
    fontFamily: fonts.medium,
    fontSize: 16,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 24,
  },
  form: { gap: 14 },
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
  invalid: { fontFamily: fonts.medium, fontSize: 13, color: colors.danger, textAlign: 'center' },
  fine: { fontFamily: fonts.medium, fontSize: 13, color: colors.muted, textAlign: 'center' },
});
