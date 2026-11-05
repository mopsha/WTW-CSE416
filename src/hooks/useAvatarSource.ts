import type { AvatarRef } from '@shared/api/avatars.ts';
import { useCallback, useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { useFocusEffect } from 'expo-router';
import { AppState } from 'react-native';
import { api } from '@/lib/api';
import { CAPABILITY_POLL_MS, createAvatarCache } from '@/lib/avatarCache';
import { subscribePhotoChanges } from '@/lib/photoEvents';
import { useAuth } from './useAuth';

export const avatarCache = createAvatarCache(api);

/** Data URIs keep private network responses out of native URL/disk image caches. */
export function useAvatarPhoto(ref?: AvatarRef | null, userId?: string) {
  const { session } = useAuth();
  const viewer = session?.user.id;
  useSyncExternalStore(avatarCache.subscribe, avatarCache.snapshot, avatarCache.snapshot);
  const [image, setImage] = useState<{ key: string; uri: string | null } | null>(null);
  const [focused, setFocused] = useState(false);
  const target = ref?.userId ?? userId;
  const revision = ref?.revision ?? (userId ? 0 : undefined);
  const resolveFirst = !ref;
  const accountScope = session?.user.email;
  const key =
    focused && viewer && target && revision !== undefined
      ? `${session?.user.email ?? ''}:${avatarCache.key(viewer, { userId: target, revision })}`
      : null;
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      if (!viewer || !target || revision === undefined) return;
      avatarCache.setViewer(viewer, accountScope ?? viewer);
      const stop = avatarCache.watch(viewer, { userId: target, revision }, resolveFirst);
      // One microtask collects all rows mounted in this render before resolving.
      void Promise.resolve().then(() => avatarCache.revalidate());
      return () => {
        setFocused(false);
        stop();
      };
    }, [viewer, target, revision, resolveFirst, accountScope]),
  );
  useEffect(() => {
    let active = true;
    if (viewer && target && revision !== undefined && key) {
      void avatarCache.load(viewer, { userId: target, revision }).then((uri) => {
        if (active) setImage({ key, uri });
      });
    }
    return () => {
      active = false;
    };
  }, [viewer, target, revision, key]);
  const uri = key && image?.key === key ? image.uri : null;
  const current =
    uri && viewer && target && revision !== undefined
      ? avatarCache.currentRef(viewer, { userId: target, revision })
      : null;
  const displayKey = current && viewer ? avatarCache.key(viewer, current) : undefined;
  const [displayToken] = useState(() => Symbol('native-avatar'));
  useLayoutEffect(() => {
    if (!displayKey) return;
    return () => avatarCache.forgetDisplay(displayToken);
  }, [displayToken, displayKey]);
  return {
    uri,
    ref: current,
    displayKey,
    displayed: !!(viewer && current && avatarCache.isDisplayed(viewer, current)),
    onDisplay: (success: boolean) => {
      if (viewer && current && displayKey)
        avatarCache.markDisplayed(displayToken, viewer, current, displayKey, success);
    },
  };
}

export function useAvatarSource(ref?: AvatarRef | null, userId?: string) {
  return useAvatarPhoto(ref, userId).uri;
}

/** Account-scoped, short-lived server capabilities; failure and expiry fail closed. */
export function usePhotoCapabilities() {
  const { session } = useAuth();
  const viewer = session?.user.id;
  const scope = session?.user.email;
  useSyncExternalStore(avatarCache.subscribe, avatarCache.snapshot, avatarCache.snapshot);
  useFocusEffect(
    useCallback(() => {
      if (!viewer) return;
      avatarCache.setViewer(viewer, scope ?? viewer);
      void avatarCache.refreshCapabilities(true);
      const timer = setInterval(() => void avatarCache.refreshCapabilities(), CAPABILITY_POLL_MS);
      const sub = AppState.addEventListener('change', (state) => {
        avatarCache.setActive(state === 'active');
        if (state === 'active') void avatarCache.refreshCapabilities(true);
      });
      return () => {
        clearInterval(timer);
        sub.remove();
      };
    }, [viewer, scope]),
  );
  return {
    ...avatarCache.capabilities(viewer),
    refresh: () => avatarCache.refreshCapabilities(true),
  };
}

/** One visibility poll for focused identities, not one metadata call per row. */
export function useAvatarLifecycle(
  viewer: string | undefined,
  pathname: string,
  accountScope?: string | null,
) {
  useLayoutEffect(() => {
    avatarCache.setViewer(viewer ?? null, accountScope ?? viewer ?? null);
  }, [viewer, accountScope]);
  useEffect(() => {
    const unsubscribe = subscribePhotoChanges(({ userId, state }) =>
      avatarCache.update(userId, state),
    );
    avatarCache.setActive(
      AppState.currentState !== 'background' && AppState.currentState !== 'inactive',
    );
    void avatarCache.revalidate();
    const timer = setInterval(() => void avatarCache.revalidate(), 30_000);
    const sub = AppState.addEventListener('change', (state) => {
      avatarCache.setActive(state === 'active');
      if (state === 'active') void avatarCache.revalidate();
    });
    return () => {
      unsubscribe();
      clearInterval(timer);
      sub.remove();
      avatarCache.clear();
    };
  }, [viewer, accountScope]);
  useEffect(() => {
    void avatarCache.revalidate();
  }, [pathname]);
}
