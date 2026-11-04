import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import type { UserProfile } from '@shared/api/userProfiles.ts';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { messageOf } from '@/lib/errors';
import { pickProfilePhoto, PhotoSelectionError, type SelectedPhoto } from '@/lib/pickProfilePhoto';
import { Avatar } from './Avatar';
import { Button } from './Button';
import { ErrorState } from './ErrorState';
import { colors, space, type } from './theme';

/** A separate transaction inside the existing editor; no metadata draft is lost
 * on a photo error. Never bind an upload to whichever account happens to be next. */
interface PhotoEditorProps {
  profile: UserProfile;
  onSaved: (profile: UserProfile) => void;
  onBusyChange: (busy: boolean) => void;
  disabled?: boolean;
}
export function ProfilePhotoEditor(props: PhotoEditorProps) {
  const { session } = useAuth();
  if (!session || session.user.id !== props.profile.id) return null;
  return (
    <PhotoEditor
      key={`${session.user.id}:${session.user.email ?? ''}:${props.profile.id}`}
      {...props}
    />
  );
}
function PhotoEditor({ profile, onSaved, onBusyChange, disabled = false }: PhotoEditorProps) {
  const [selected, setSelected] = useState<SelectedPhoto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permission, setPermission] = useState(false);
  const pending = useRef(false);
  const epoch = useRef(0);
  const latestProfile = useRef(profile);
  const busyChanged = useRef(onBusyChange);
  useLayoutEffect(() => {
    latestProfile.current = profile;
    busyChanged.current = onBusyChange;
  }, [profile, onBusyChange]);
  useEffect(
    () => () => {
      epoch.current++;
      busyChanged.current(false);
    },
    [],
  );
  async function run(action: () => Promise<void>, reconcile = false) {
    if (pending.current || disabled) return;
    pending.current = true;
    setBusy(true);
    onBusyChange(true);
    setError(null);
    setPermission(false);
    const request = ++epoch.current;
    try {
      await action();
    } catch (e) {
      if (request === epoch.current) {
        setError(messageOf(e));
        setPermission(e instanceof PhotoSelectionError && e.permission);
        // Refresh the revision after a conflict/uncertain commit. Do not retry an
        // overwrite automatically or discard the user's unsaved preview.
        try {
          if (!reconcile) return;
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            const latest = await Promise.race([
              api.getMyUserProfile(),
              new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error('Profile refresh timed out')), 5000);
              }),
            ]);
            if (request === epoch.current && latest.id === profile.id) onSaved(latest);
          } finally {
            clearTimeout(timer);
          }
        } catch {
          /* Keep the previous persisted profile and explicit retry. */
        }
      }
    } finally {
      if (request === epoch.current) {
        pending.current = false;
        setBusy(false);
        busyChanged.current(false);
      }
    }
  }
  async function choose() {
    await run(async () => {
      const request = epoch.current;
      const photo = await pickProfilePhoto();
      if (request === epoch.current && photo) setSelected(photo);
    });
  }
  async function save(remove = false) {
    await run(async () => {
      if (profile.avatarRevision === undefined)
        throw new Error('Reload your profile before changing its photo.');
      const request = epoch.current;
      const result = remove
        ? await api.removeAvatar(profile.id, profile.avatarRevision)
        : selected
          ? await api.uploadAvatar(profile.id, profile.avatarRevision, selected.bytes)
          : null;
      if (result && request === epoch.current) {
        const latest = latestProfile.current;
        onSaved(
          (latest.avatarRevision ?? 0) > result.revision
            ? latest
            : {
                ...latest,
                avatarUrl: null,
                avatarRef: result.avatarRef,
                avatarRevision: result.revision,
              },
        );
        setSelected(null);
      }
    }, true);
  }
  return (
    <View style={{ gap: space.sm }}>
      <Text style={{ ...type.body, color: colors.text }}>Profile photo</Text>
      <Avatar
        name={profile.displayName ?? 'You'}
        size={72}
        uri={selected?.previewUri ?? profile.avatarUrl}
        avatarRef={selected ? undefined : profile.avatarRef}
      />
      <Button
        label="Change photo"
        icon="image-outline"
        variant="secondary"
        disabled={disabled || busy}
        onPress={() => void choose()}
      />
      {selected ? (
        <>
          <Text style={{ ...type.caption, color: colors.muted }}>
            Preview — save to update your profile photo.
          </Text>
          <Button
            label="Save photo"
            variant="secondary"
            loading={busy}
            disabled={disabled}
            onPress={() => void save()}
          />
          <Button
            label="Cancel photo change"
            variant="link"
            disabled={busy}
            onPress={() => {
              setSelected(null);
              setError(null);
              setPermission(false);
            }}
          />
        </>
      ) : profile.avatarRef || profile.avatarUrl ? (
        <Button
          label="Remove photo"
          variant="link"
          loading={busy}
          disabled={disabled}
          onPress={() => void save(true)}
        />
      ) : null}
      {busy ? (
        <Text accessibilityLiveRegion="polite" style={{ ...type.caption, color: colors.muted }}>
          Updating photo…
        </Text>
      ) : null}
      {error ? <ErrorState message={error} /> : null}
      {permission ? (
        <Button
          label="Open photo settings"
          variant="link"
          disabled={busy}
          onPress={() =>
            void Linking.openSettings().catch(() =>
              setError('Open Settings to allow photo access.'),
            )
          }
        />
      ) : null}
    </View>
  );
}
