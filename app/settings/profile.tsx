import { BirthdayField } from '@/components/BirthdayField';
import { useCallback, useEffect, useRef, useState } from 'react';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { parseProfileUpdate } from '@shared/api/profile.ts';
import {
  parseProfileDetails,
  type ProfileDetailsInput,
  type UserProfile,
} from '@shared/api/userProfiles.ts';
import { Button, ErrorState, Screen, colors, MIN_TARGET, radius, space, type } from '@/components';
import { ProfilePhotoEditor } from '@/components/ProfilePhotoEditor';
import { useSession } from '@/hooks/useAuth';
import { useProfile } from '@/hooks/useProfile';
import { api } from '@/lib/api';
import { messageOf } from '@/lib/errors';

const detailsOf = (p: UserProfile): ProfileDetailsInput => ({
  birthday: p.birthday ? { month: p.birthday.month, day: p.birthday.day } : null,
  shareBirthday: p.shareBirthday ?? false,
  username: p.username,
  favoriteCuisine: p.favoriteCuisine,
  favoriteActivity: p.favoriteActivity,
  shareMetadata: p.shareMetadata ?? false,
});
const goBack = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/profile'));

export default function EditProfileSettings() {
  const session = useSession();
  // A new account gets a new form; stale responses cannot populate its drafts.
  return (
    <EditProfile
      key={`${session.user.id}:${session.user.email ?? ''}`}
      userId={session.user.id}
      email={session.user.email ?? undefined}
    />
  );
}
function EditProfile({ userId, email }: { userId: string; email?: string }) {
  const { section } = useLocalSearchParams<{ section?: string }>();
  const { saveDisplayName, saveProfileDetails } = useProfile();
  const navigation = useNavigation();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [name, setName] = useState('');
  const [draft, setDraft] = useState<ProfileDetailsInput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoSelected, setPhotoSelected] = useState(false);
  const pending = useRef(false);
  const photoPending = useRef(false);
  const active = useRef(true);
  const request = useRef(0);
  const privacyOpened = useRef(false);
  const scroll = useRef<ScrollView>(null);
  const dirty =
    !!profile &&
    !!draft &&
    (name !== (profile.displayName ?? '') ||
      JSON.stringify(draft) !== JSON.stringify(detailsOf(profile)));
  usePreventRemove(busy || photoBusy || dirty || photoSelected, ({ data }) => {
    if (pending.current || photoPending.current) return;
    if (Platform.OS === 'web') {
      if (globalThis.confirm('Discard unsaved changes? Changes already saved will be kept.'))
        navigation.dispatch(data.action);
      return;
    }
    Alert.alert('Discard unsaved changes?', 'Changes already saved will be kept.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => navigation.dispatch(data.action) },
    ]);
  });
  const load = useCallback(async () => {
    const id = ++request.current;
    try {
      const p = await api.getMyUserProfile();
      if (!active.current || id !== request.current) return;
      if (p.id !== userId || !p.isOwner)
        throw new Error('Your profile could not be verified. Try again.');
      setError(null);
      setProfile(p);
      setName(p.displayName ?? '');
      setDraft(detailsOf(p));
    } catch (e) {
      if (active.current && id === request.current) setError(messageOf(e));
    }
  }, [userId]);
  useEffect(() => {
    active.current = true;
    void Promise.resolve().then(() => {
      if (active.current) void load();
    });
    return () => {
      active.current = false;
    };
  }, [load]);
  async function save() {
    if (pending.current || photoPending.current || !profile || !draft || !dirty) return;
    let displayName: string;
    let input: ProfileDetailsInput;
    try {
      displayName = parseProfileUpdate({ displayName: name });
      input = parseProfileDetails(draft, profile.username);
      if (!input.username) throw new Error('Username is required');
    } catch (e) {
      setError(messageOf(e));
      return;
    }
    pending.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    let detailsSaved = false;
    let stage = 'Profile details';
    try {
      // Validate every field before either request. The existing endpoints are
      // separate transactions; record confirmed progress and retry only the remainder.
      let savedDetails = detailsOf(profile);
      if (JSON.stringify(input) !== JSON.stringify(savedDetails)) {
        const saved = await saveProfileDetails(input);
        if (!active.current) return;
        if (saved.id !== userId || !saved.isOwner) throw new Error('Unexpected profile response');
        savedDetails = detailsOf(saved);
        detailsSaved = true;
        setProfile((p) => (p ? { ...p, ...savedDetails } : p));
        setDraft(savedDetails);
      }
      stage = 'Display name';
      if (displayName !== profile.displayName) {
        await saveDisplayName(displayName);
        if (!active.current) return;
      }
      setProfile((p) => (p ? { ...p, displayName } : p));
      setName(displayName);
      setDraft(savedDetails);
      setNotice('Profile details saved.');
    } catch (e) {
      if (active.current)
        setError(
          `${detailsSaved ? 'Username, favorites, birthday and privacy saved. ' : ''}${stage} could not be confirmed saved: ${messageOf(e)}. Review your changes and retry Save.`,
        );
    } finally {
      pending.current = false;
      if (active.current) setBusy(false);
    }
  }
  const locked = busy || photoBusy;
  return (
    <Screen
      scroll={false}
      contentStyle={s.frame}
      keyboardBehavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      fixedHeader={
        <View style={s.header}>
          <Button label="Back" variant="link" size="compact" onPress={goBack} disabled={locked} />
          <Text accessibilityRole="header" style={s.title}>
            Edit profile
          </Text>
          <Button
            label="Save"
            variant="link"
            size="compact"
            loading={busy}
            disabled={locked || !dirty}
            onPress={() => void save()}
          />
        </View>
      }
    >
      <ScrollView
        ref={scroll}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={s.content}
      >
        {!profile || !draft ? (
          error ? (
            <ErrorState message={error} onRetry={() => void load()} />
          ) : (
            <ActivityIndicator color={colors.primary} accessibilityLabel="Loading profile" />
          )
        ) : (
          <>
            <ProfilePhotoEditor
              profile={profile}
              variant="page"
              disabled={busy}
              isBlocked={() => pending.current}
              onSelectionChange={setPhotoSelected}
              onBusyChange={(value) => {
                photoPending.current = value;
                setPhotoBusy(value);
              }}
              onSaved={(p) =>
                setProfile((current) =>
                  current && p.id === userId
                    ? {
                        ...current,
                        avatarUrl: p.avatarUrl,
                        avatarRef: p.avatarRef,
                        avatarRevision: p.avatarRevision,
                      }
                    : current,
                )
              }
            />
            <View style={s.group}>
              <Field
                label="Display name"
                value={name}
                onChangeText={(value) => {
                  setName(value);
                  setNotice(null);
                }}
                editable={!locked}
                autoCapitalize="words"
                autoComplete="name"
              />
              <Field
                label="Username"
                value={draft.username ?? ''}
                onChangeText={(username) => {
                  setDraft({ ...draft, username });
                  setNotice(null);
                }}
                editable={!locked}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="username"
              />
            </View>
            <Text style={s.caption}>
              Your name, username and available photo are visible to friends.
            </Text>
            <View style={s.group}>
              <Field
                label="Favorite cuisine"
                placeholder="Optional"
                value={draft.favoriteCuisine ?? ''}
                editable={!locked}
                onChangeText={(favoriteCuisine) => {
                  setDraft({ ...draft, favoriteCuisine });
                  setNotice(null);
                }}
              />
              <Field
                label="Favorite activity"
                placeholder="Optional"
                value={draft.favoriteActivity ?? ''}
                editable={!locked}
                onChangeText={(favoriteActivity) => {
                  setDraft({ ...draft, favoriteActivity });
                  setNotice(null);
                }}
              />
            </View>
            <View style={s.birthday}>
              <BirthdayField
                value={draft.birthday ?? null}
                disabled={locked}
                onChange={(birthday) => {
                  setDraft({ ...draft, birthday, ...(!birthday ? { shareBirthday: false } : {}) });
                  setNotice(null);
                }}
              />
              <View style={s.privacyRow}>
                <Text style={s.privacyLabel}>Show birthday to friends</Text>
                <Switch
                  accessibilityLabel="Show birthday to friends"
                  accessibilityHint="Only accepted, unblocked friends can see your month and day. No birth year is collected."
                  value={draft.shareBirthday ?? false}
                  disabled={locked || !draft.birthday}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  style={s.toggle}
                  onValueChange={(shareBirthday) => {
                    setDraft({ ...draft, shareBirthday });
                    setNotice(null);
                  }}
                />
              </View>
              <Text style={s.caption}>
                Share only your month and day with accepted, unblocked friends. No birth year is
                collected.
              </Text>
            </View>
            <View
              style={s.privacy}
              onLayout={({ nativeEvent }) => {
                if (section === 'privacy' && !privacyOpened.current) {
                  privacyOpened.current = true;
                  scroll.current?.scrollTo({ y: nativeEvent.layout.y, animated: true });
                }
              }}
            >
              <View style={s.privacyRow}>
                <Text style={s.privacyLabel}>Share profile details</Text>
                <Switch
                  accessibilityLabel="Share profile metadata with friends"
                  accessibilityHint="Shares counts, favorites, mutual groups and shared Pick Past Moves with accepted, unblocked friends."
                  value={draft.shareMetadata}
                  disabled={locked}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  style={s.toggle}
                  onValueChange={(shareMetadata) => {
                    setDraft({ ...draft, shareMetadata });
                    setNotice(null);
                  }}
                />
              </View>
              <Text style={s.caption}>
                Let accepted, unblocked friends see your counts, favorites, mutual groups and
                confirmed Past Moves from Picks you shared. Discover preferences stay private.
              </Text>
            </View>
            {error ? <ErrorState message={error} /> : null}
            {notice ? (
              <Text accessibilityLiveRegion="polite" style={s.status}>
                {notice}
              </Text>
            ) : null}
            {email ? (
              <Text selectable style={s.caption}>
                {email}
              </Text>
            ) : null}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        selectionColor={colors.primary}
        style={s.input}
        {...props}
      />
    </View>
  );
}
const s = StyleSheet.create({
  frame: { padding: 0, paddingBottom: 0, gap: 0 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.xs,
    paddingVertical: space.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  title: {
    ...type.body,
    fontFamily: type.heading.fontFamily,
    color: colors.text,
    flex: 1,
    textAlign: 'center',
  },
  content: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  group: { borderRadius: radius.sm, backgroundColor: colors.card, overflow: 'hidden' },
  field: {
    paddingHorizontal: space.md,
    paddingTop: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  label: { ...type.caption, color: colors.muted },
  input: { ...type.body, color: colors.text, minHeight: MIN_TARGET, paddingVertical: space.sm },
  caption: { ...type.caption, color: colors.muted },
  birthday: { gap: space.sm },
  privacy: { gap: space.xs },
  privacyRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  privacyLabel: { ...type.body, color: colors.text, flex: 1 },
  toggle: { minHeight: MIN_TARGET, minWidth: MIN_TARGET },
  status: { ...type.body, color: colors.text },
});
