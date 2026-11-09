import { usePhotoCapabilities } from '@/hooks/useAvatarSource';
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
  variant?: 'default' | 'page';
  isBlocked?: () => boolean;
  onSelectionChange?: (selected: boolean) => void;
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
function PhotoEditor({
  profile,
  onSaved,
  onBusyChange,
  disabled = false,
  variant = 'default',
  isBlocked,
  onSelectionChange,
}: PhotoEditorProps) {
  const capabilities = usePhotoCapabilities();
  const [selected, setSelected] = useState<SelectedPhoto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permission, setPermission] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  useEffect(() => {
    onSelectionChange?.(!!selected);
  }, [selected, onSelectionChange]);
  const pending = useRef(false);
  const epoch = useRef(0);
  const latestProfile = useRef(profile);
  const busyChanged = useRef(onBusyChange);
  const savedChanged = useRef(onSaved);
  const mutationVersion = useRef(0);
  useLayoutEffect(() => {
    latestProfile.current = profile;
    busyChanged.current = onBusyChange;
    savedChanged.current = onSaved;
  }, [profile, onBusyChange, onSaved]);
  useEffect(() => {
    let active = true;
    const version = mutationVersion.current;
    // Mounted anew whenever the existing details sheet opens. Refresh only photo
    // fields: metadata drafts and a local selection belong to the editor.
    void api
      .getMyUserProfile()
      .then((fresh) => {
        const latest = latestProfile.current;
        if (
          !active ||
          version !== mutationVersion.current ||
          fresh.id !== profile.id ||
          fresh.avatarRevision === undefined ||
          fresh.avatarRevision < (latest.avatarRevision ?? 0)
        )
          return;
        if (
          fresh.avatarRevision === latest.avatarRevision &&
          fresh.avatarUrl === latest.avatarUrl &&
          fresh.avatarRef?.revision === latest.avatarRef?.revision
        )
          return;
        savedChanged.current({
          ...latest,
          avatarUrl: fresh.avatarUrl,
          avatarRef: fresh.avatarRef,
          avatarRevision: fresh.avatarRevision,
        });
      })
      .catch((e) => {
        if (active && version === mutationVersion.current) setError(messageOf(e));
      });
    return () => {
      active = false;
    };
  }, [profile.id]);
  useEffect(
    () => () => {
      epoch.current++;
      busyChanged.current(false);
    },
    [],
  );
  async function run(action: () => Promise<void>, reconcile = false) {
    if (pending.current || disabled || isBlocked?.()) return;
    pending.current = true;
    setBusy(true);
    onBusyChange(true);
    setError(null);
    setStatus(null);
    setPermission(false);
    const request = ++epoch.current;
    try {
      await action();
    } catch (e) {
      if (request === epoch.current) {
        setError(messageOf(e));
        void capabilities.refresh();
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
            if (
              request === epoch.current &&
              latest.id === profile.id &&
              latest.avatarRevision !== undefined &&
              latest.avatarRevision >= (latestProfile.current.avatarRevision ?? 0)
            )
              onSaved(latest);
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
    if (!capabilities.uploadsEnabled) return;
    await run(async () => {
      const request = epoch.current;
      const photo = await pickProfilePhoto();
      if (request === epoch.current && photo) setSelected(photo);
    });
  }
  async function save(remove = false) {
    if (!remove && !capabilities.uploadsEnabled) return;
    await run(async () => {
      mutationVersion.current++;
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
        setStatus(remove ? 'Photo removed.' : 'Photo saved.');
      }
    }, true);
  }
  // Keep capability fetching mounted, but do not advertise an unavailable feature.
  if (
    variant !== 'page' &&
    !capabilities.uploadsEnabled &&
    !profile.avatarRef &&
    !profile.avatarUrl &&
    !selected &&
    !busy
  )
    return null;
  return (
    <View
      style={{ gap: space.xs, ...(variant === 'page' ? { alignItems: 'center' as const } : {}) }}
    >
      {variant === 'default' ? (
        <Text style={{ ...type.body, color: colors.text }}>Profile photo</Text>
      ) : null}
      <Avatar
        name={profile.displayName ?? 'You'}
        size={variant === 'page' ? 88 : 72}
        uri={selected?.previewUri ?? profile.avatarUrl}
        avatarRef={selected ? undefined : profile.avatarRef}
        userId={selected ? undefined : profile.id}
      />
      {capabilities.uploadsEnabled ? (
        <Button
          label="Change photo"
          icon="image-outline"
          variant={variant === 'page' ? 'link' : 'secondary'}
          size="compact"
          disabled={disabled || busy || !capabilities.uploadsEnabled}
          onPress={() => void choose()}
        />
      ) : variant === 'page' ? (
        <Text style={{ ...type.caption, color: colors.muted, textAlign: 'center' }}>
          Photo uploads are currently unavailable.
        </Text>
      ) : null}
      {selected ? (
        <>
          {capabilities.uploadsEnabled ? (
            <Text style={{ ...type.caption, color: colors.muted }}>
              Preview — save to update your profile photo.
            </Text>
          ) : null}
          {capabilities.uploadsEnabled ? (
            <Button
              label="Save photo"
              variant="secondary"
              loading={busy}
              disabled={disabled || !capabilities.uploadsEnabled}
              onPress={() => void save()}
            />
          ) : null}
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
      {status ? (
        <Text accessibilityLiveRegion="polite" style={{ ...type.caption, color: colors.text }}>
          {status}
        </Text>
      ) : null}
      {variant === 'page' &&
      (capabilities.uploadsEnabled || profile.avatarRef || profile.avatarUrl) ? (
        <Text style={{ ...type.caption, color: colors.muted, textAlign: 'center' }}>
          Photo changes save separately from profile details.
        </Text>
      ) : null}
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
