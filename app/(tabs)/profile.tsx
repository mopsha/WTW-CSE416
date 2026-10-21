import { DISPLAY_NAME_MAX, validateDisplayName } from '@shared/api/profile.ts';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import {
  Avatar,
  Button,
  Card,
  colors,
  ErrorState,
  fonts,
  MIN_TARGET,
  radius,
  Screen,
  space,
  type,
} from '@/components';
import { useAction } from '@/hooks/useAction';
import { useSession } from '@/hooks/useAuth';
import { suggestedName, useProfile } from '@/hooks/useProfile';
import { auth } from '@/lib/auth';

// My name (what friends see in Picks), my email, and sign-out.
export default function ProfileScreen() {
  const session = useSession();
  const { displayName, saveDisplayName } = useProfile();
  const email = session.user.email ?? 'you';
  const name = displayName || suggestedName(session.user.email) || email;
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<string | null>(null);
  const { busy, error, run, clearError } = useAction();

  async function save() {
    if (draft === null) return;
    const result = validateDisplayName(draft);
    if ('error' in result) {
      setInvalid(result.error);
      return;
    }
    if (await run('save', () => saveDisplayName(result.name))) setDraft(null);
  }

  function cancel() {
    setDraft(null);
    setInvalid(null);
    clearError();
  }

  return (
    <Screen title="Profile" edges={['top', 'left', 'right']}>
      <Card>
        <View style={styles.row}>
          <Avatar name={draft?.trim() || name} size={56} />
          <View style={styles.who}>
            <Text style={styles.name}>{name}</Text>
            <Text style={styles.email}>{email}</Text>
          </View>
        </View>
        {draft === null ? (
          <Button
            label={displayName ? 'Edit name' : 'Set your name'}
            variant="secondary"
            icon="create-outline"
            accessibilityHint="Changes the name your friends see in Picks"
            onPress={() => setDraft(displayName ?? suggestedName(session.user.email))}
            style={styles.edit}
          />
        ) : (
          <View style={styles.form}>
            <TextInput
              style={styles.input}
              value={draft}
              onChangeText={(text) => {
                setDraft(text);
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
              editable={!busy}
            />
            {invalid ? (
              <Text style={styles.invalid} accessibilityLiveRegion="polite">
                {invalid}
              </Text>
            ) : null}
            <View style={styles.actions}>
              <Button label="Cancel" variant="link" onPress={cancel} disabled={!!busy} />
              <Button
                label="Save"
                onPress={() => void save()}
                loading={busy === 'save'}
                disabled={!draft.trim()}
                style={styles.save}
              />
            </View>
          </View>
        )}
      </Card>
      {error ? <ErrorState message={error} /> : null}
      <Button
        label="Sign out"
        variant="danger"
        icon="log-out-outline"
        onPress={() => void auth.signOut()}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  who: { flex: 1, gap: 2 },
  name: { ...type.heading, color: colors.text },
  email: { ...type.caption, color: colors.muted },
  edit: { marginTop: space.lg },
  form: { gap: space.md, marginTop: space.lg },
  input: {
    minHeight: MIN_TARGET + 4,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: space.lg + 2,
    fontFamily: fonts.medium,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.cardHi,
  },
  invalid: { ...type.caption, color: colors.danger },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm },
  save: { minWidth: 120 },
});
