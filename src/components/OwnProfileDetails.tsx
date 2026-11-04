import {
  parseProfileDetails,
  type UserProfile,
  type ProfileDetailsInput,
} from '@shared/api/userProfiles.ts';
import { useRef, useState } from 'react';
import { StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Button, ErrorState, colors, MIN_TARGET, radius, space, type } from '@/components';
import { api } from '@/lib/api';
import { messageOf } from '@/lib/errors';
import { Sheet } from './TabUi';
import { UserProfileMetadata } from './UserProfileMetadata';
export function OwnProfileDetails({
  profile,
  onSaved,
  initiallyOpen = false,
  variant = 'default',
  email,
}: {
  profile: UserProfile;
  onSaved: (p: UserProfile) => void;
  initiallyOpen?: boolean;
  variant?: 'default' | 'profile';
  email?: string;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const [draft, setDraft] = useState<ProfileDetailsInput>({
    username: profile.username,
    favoriteCuisine: profile.favoriteCuisine,
    favoriteActivity: profile.favoriteActivity,
    shareMetadata: profile.shareMetadata ?? false,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const save = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      const input = parseProfileDetails(draft);
      if (profile.username && !input.username) throw new Error('Username is required');
      const updated = await api.updateProfileDetails(input);
      onSaved(updated);
      setOpen(false);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <View style={{ gap: space.md }}>
      {variant === 'default' ? <UserProfileMetadata profile={profile} /> : null}
      <Button
        label="Profile details & privacy"
        variant={variant === 'profile' ? 'link' : 'secondary'}
        style={variant === 'profile' ? { alignSelf: 'center' } : undefined}
        onPress={() => {
          setDraft({
            username: profile.username,
            favoriteCuisine: profile.favoriteCuisine,
            favoriteActivity: profile.favoriteActivity,
            shareMetadata: profile.shareMetadata ?? false,
          });
          setError(null);
          setOpen(true);
        }}
      />
      <Sheet
        visible={open}
        title="Profile details & privacy"
        onClose={() => {
          if (!pending.current) setOpen(false);
        }}
      >
        <View style={{ gap: space.md }}>
          {email ? (
            <Text selectable style={s.caption}>
              {email}
            </Text>
          ) : null}
          {error ? <ErrorState message={error} /> : null}
          <Text style={s.label}>Username</Text>
          <TextInput
            accessibilityLabel="Username"
            style={s.input}
            autoCapitalize="none"
            autoCorrect={false}
            value={draft.username ?? ''}
            placeholder="3–24 letters, numbers or underscores"
            placeholderTextColor={colors.muted}
            editable={!busy}
            onChangeText={(username) => setDraft((d) => ({ ...d, username }))}
          />
          <Text style={s.label}>Favorite cuisine (optional)</Text>
          <TextInput
            accessibilityLabel="Favorite cuisine"
            style={s.input}
            value={draft.favoriteCuisine ?? ''}
            placeholder="e.g. Japanese"
            placeholderTextColor={colors.muted}
            editable={!busy}
            onChangeText={(favoriteCuisine) => setDraft((d) => ({ ...d, favoriteCuisine }))}
          />
          <Text style={s.label}>Favorite activity (optional)</Text>
          <TextInput
            accessibilityLabel="Favorite activity"
            style={s.input}
            value={draft.favoriteActivity ?? ''}
            placeholder="e.g. Basketball"
            placeholderTextColor={colors.muted}
            editable={!busy}
            onChangeText={(favoriteActivity) => setDraft((d) => ({ ...d, favoriteActivity }))}
          />
          <View style={s.row}>
            <Text style={[s.label, { flex: 1 }]}>Share profile metadata with friends</Text>
            <Switch
              accessibilityLabel="Share profile metadata with friends"
              style={{ minHeight: MIN_TARGET, minWidth: MIN_TARGET }}
              disabled={busy}
              value={draft.shareMetadata}
              onValueChange={(shareMetadata) => setDraft((d) => ({ ...d, shareMetadata }))}
            />
          </View>
          <Text style={s.caption}>
            Shares your friends count, groups count, favorites, mutual groups and confirmed Past
            Moves from Picks you shared with accepted friends. Your name, username and available
            avatar remain visible to friends. Discover preferences stay private.
          </Text>
          <Button label="Save profile details" loading={busy} onPress={() => void save()} />
          <Button
            label="Cancel"
            variant="secondary"
            disabled={busy}
            onPress={() => setOpen(false)}
          />
        </View>
      </Sheet>
    </View>
  );
}
const s = StyleSheet.create({
  label: { ...type.body, color: colors.text },
  caption: { ...type.caption, color: colors.muted },
  row: { flexDirection: 'row', gap: space.md, alignItems: 'center' },
  input: {
    ...type.body,
    color: colors.text,
    backgroundColor: colors.card,
    minHeight: MIN_TARGET,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.md,
  },
});
