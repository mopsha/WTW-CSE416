import { Ionicons } from '@expo/vector-icons';
import { useLayoutEffect, useRef, useState } from 'react';
import type { AvatarRef } from '@shared/api/avatars.ts';
import { useAvatarPhoto } from '@/hooks/useAvatarSource';
import { Image, StyleSheet, Text, View } from 'react-native';

import { colorForName, initialsFor } from '@/lib/avatar';

import { colors, fonts, friendsTheme } from './theme';

interface AvatarProps {
  name: string;
  /** Profile photo; falls back to initials. */
  uri?: string | null;
  avatarRef?: AvatarRef | null;
  /** For existing person projections without a photo ref; resolved in a batch. */
  userId?: string;
  size?: number;
  neutral?: boolean;
  variant?: 'default' | 'social';
  /** Small green check, e.g. "finished swiping". */
  done?: boolean;
}

/** A person's photo or initials in a colored circle. */
export function Avatar(props: AvatarProps) {
  return props.avatarRef || props.userId ? (
    <ManagedAvatar {...props} />
  ) : (
    <AvatarImage {...props} />
  );
}
function ManagedAvatar(props: AvatarProps) {
  const managed = useAvatarPhoto(props.avatarRef, props.userId);
  return (
    <AvatarImage
      {...props}
      uri={managed.uri}
      imageKey={managed.displayKey}
      onDisplay={managed.onDisplay}
    />
  );
}
type AvatarImageProps = AvatarProps & { imageKey?: string; onDisplay?: (success: boolean) => void };
/** Reset before commit without copying private data URIs into React keys. */
function AvatarImage(props: AvatarImageProps) {
  const person = props.avatarRef?.userId ?? props.userId;
  const revision = props.avatarRef?.revision;
  const [identity, setIdentity] = useState(() => ({
    source: props.uri,
    key: props.imageKey,
    name: props.name,
    person,
    revision,
    version: 0,
  }));
  if (
    identity.source !== props.uri ||
    identity.key !== props.imageKey ||
    identity.name !== props.name ||
    identity.person !== person ||
    identity.revision !== revision
  ) {
    setIdentity({
      source: props.uri,
      key: props.imageKey,
      name: props.name,
      person,
      revision,
      version: identity.version + 1,
    });
  }
  return <AvatarImageContent key={identity.version} {...props} />;
}
function AvatarImageContent({
  name,
  uri: source,
  size = 40,
  done = false,
  neutral = false,
  variant = 'default',
  imageKey,
  onDisplay,
}: AvatarImageProps) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const active = useRef(true);
  const rejected = useRef(false);
  const display = useRef(onDisplay);
  useLayoutEffect(() => {
    active.current = true;
    const notify = display.current;
    notify?.(false);
    return () => {
      active.current = false;
      notify?.(false);
    };
  }, []);
  let hash = 0;
  for (const ch of name.trim().toLowerCase()) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <View
      style={[
        styles.circle,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor:
            variant === 'social'
              ? friendsTheme.identities[hash % friendsTheme.identities.length]
              : neutral
                ? colors.cardHi
                : colorForName(name),
        },
      ]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={done ? `${name}, done` : name}
    >
      {!loaded ? (
        <Text
          style={[
            styles.initials,
            { fontSize: size * 0.4 },
            variant === 'social' && {
              fontFamily: fonts.semibold,
              color: colors.text,
              fontSize: (size * 23) / 60,
            },
          ]}
          maxFontSizeMultiplier={variant === 'social' ? 1.4 : undefined}
        >
          {initialsFor(name)}
        </Text>
      ) : null}
      {source && !failed ? (
        <Image
          key={imageKey}
          onLoad={() => {
            if (!active.current || rejected.current) return;
            setLoaded(true);
            onDisplay?.(true);
          }}
          source={{ uri: source }}
          onError={() => {
            if (!active.current) return;
            rejected.current = true;
            setLoaded(false);
            setFailed(true);
            onDisplay?.(false);
          }}
          style={[
            StyleSheet.absoluteFill,
            { width: size, height: size, borderRadius: size / 2, opacity: loaded ? 1 : 0 },
          ]}
        />
      ) : null}
      {done ? (
        <View style={styles.badge}>
          <Ionicons name="checkmark" size={Math.max(10, size * 0.3)} color={colors.bg} />
        </View>
      ) : null}
    </View>
  );
}

/** Overlapping avatars for a group (e.g. a Pick's participants). */
export function AvatarStack({
  people,
  size = 32,
  max = 5,
}: {
  people: readonly {
    name: string;
    uri?: string | null;
    userId?: string;
    avatarRef?: AvatarRef | null;
    done?: boolean;
  }[];
  size?: number;
  max?: number;
}) {
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  return (
    <View
      style={styles.stack}
      accessible
      accessibilityLabel={`${people.length} ${people.length === 1 ? 'person' : 'people'}: ${people
        .map((p) => p.name)
        .join(', ')}`}
    >
      {shown.map((p, i) => (
        <View key={`${p.name}-${i}`} style={i > 0 ? { marginLeft: -size * 0.3 } : undefined}>
          <View style={[styles.ring, { borderRadius: size / 2 + 2 }]}>
            <Avatar
              name={p.name}
              uri={p.uri}
              userId={p.userId}
              avatarRef={p.avatarRef}
              size={size}
              done={p.done}
            />
          </View>
        </View>
      ))}
      {extra > 0 ? (
        <View
          style={[
            styles.more,
            { width: size, height: size, borderRadius: size / 2, marginLeft: -size * 0.3 },
          ]}
        >
          <Text style={[styles.moreText, { fontSize: size * 0.36 }]}>+{extra}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center' },
  initials: { fontFamily: fonts.bold, color: '#FFFFFF' },
  badge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    backgroundColor: colors.yes,
    borderRadius: 999,
    padding: 1,
    borderWidth: 1.5,
    borderColor: colors.bg,
  },
  stack: { flexDirection: 'row', alignItems: 'center' },
  ring: { borderWidth: 2, borderColor: colors.bg },
  more: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.cardHi,
    borderWidth: 2,
    borderColor: colors.bg,
  },
  moreText: { fontFamily: fonts.bold, color: colors.text },
});
