import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { useJoinPick } from '@/hooks/useJoinPick';
import { JOIN_CODE_LENGTH } from '@/lib/join';

import { Button } from './Button';
import { Card } from './Card';
import { colors, fonts, MIN_TARGET, space, type } from './theme';

/** "Join with code" on the Picks tab: type a friend's 6-character code, land in their Pick. */
export function JoinCodeCard() {
  const [code, setCode] = useState('');
  const { busy, error, join, clearError } = useJoinPick();

  const submit = async () => {
    if (busy) return;
    const pickId = await join(code);
    if (!pickId) return;
    setCode('');
    router.push({ pathname: '/pick/[id]', params: { id: pickId } });
  };

  return (
    <Card>
      <Text style={styles.title} accessibilityRole="header">
        Join with code
      </Text>
      <View style={styles.row}>
        <TextInput
          style={styles.input}
          value={code}
          onChangeText={(t) => {
            setCode(t.toUpperCase());
            if (error) clearError();
          }}
          placeholder="K7P2QX"
          placeholderTextColor={colors.muted}
          autoCapitalize="characters"
          autoCorrect={false}
          autoComplete="off"
          spellCheck={false}
          // Room for a stray space; the server ignores spaces and case.
          maxLength={JOIN_CODE_LENGTH + 2}
          returnKeyType="go"
          onSubmitEditing={() => void submit()}
          editable={!busy}
          accessibilityLabel="Join code"
          accessibilityHint="The 6-character code from a friend's Pick"
        />
        <Button
          label="Join"
          variant="secondary"
          onPress={() => void submit()}
          loading={busy}
          disabled={!code.trim()}
          accessibilityLabel="Join Pick with this code"
        />
      </View>
      {error ? (
        <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  title: { ...type.heading, color: colors.text },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.md },
  input: {
    flex: 1,
    minHeight: MIN_TARGET + 4,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 20,
    fontFamily: fonts.bold,
    fontSize: 18,
    letterSpacing: 3,
    color: colors.text,
    backgroundColor: colors.cardHi,
  },
  error: { ...type.caption, color: colors.danger, marginTop: space.sm },
});
