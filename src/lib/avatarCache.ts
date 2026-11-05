import type { AvatarChange, AvatarRef } from '@shared/api/avatars.ts';

interface PhotoLoader {
  getAvatar(viewer: string, ref: AvatarRef, signal: AbortSignal): Promise<string>;
  resolveAvatarRefs(
    viewer: string,
    ids: string[],
    signal: AbortSignal,
  ): Promise<Record<string, AvatarChange>>;
}
/** Only the cache is retained between mounted image consumers: at most 32 images
 * and 8 MiB of encoded characters, for a bounded authorization lease. */
export const AVATAR_AUTH_LEASE_MS = 60_000;
const denied = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  'status' in error &&
  [401, 403, 404].includes(Number(error.status));

export function createAvatarCache(loader: PhotoLoader, now = Date.now) {
  let viewer: string | null = null;
  let accountScope: string | null = null;
  let active = true;
  let epoch = 0;
  let version = 0;
  let generationSequence = 0;
  let manifest: AbortController | null = null;
  const listeners = new Set<() => void>();
  const watches = new Map<string, Map<symbol, AvatarRef>>();
  const latest = new Map<string, AvatarChange>();
  const generations = new Map<string, number>();
  const images = new Map<string, { uri: string; expires: number }>();
  const leases = new Map<string, number>();
  const failed = new Map<string, number>();
  const pending = new Map<
    string,
    { controller: AbortController; promise: Promise<string | null> }
  >();
  const notify = () => {
    version++;
    listeners.forEach((fn) => fn());
  };
  const bump = (id: string) => generations.set(id, ++generationSequence);
  function clearBytes() {
    epoch++;
    manifest?.abort();
    manifest = null;
    pending.forEach((value) => value.controller.abort());
    pending.clear();
    images.clear();
    leases.clear();
    failed.clear();
  }
  function setViewer(id: string | null, scope: string | null = id) {
    if (viewer === id && accountScope === scope) return;
    clearBytes();
    viewer = id;
    accountScope = scope;
    watches.clear();
    latest.clear();
    generations.clear();
    notify();
  }
  function update(id: string, state?: AvatarChange, authoritative = false) {
    const previous = latest.get(id);
    if (!authoritative && state && previous && state.revision < previous.revision) return;
    leases.delete(id);
    if (watches.has(id)) {
      latest.set(id, state ?? { revision: previous?.revision ?? 0, avatarRef: null });
      bump(id);
    }
    for (const key of images.keys()) if (key.startsWith(`${id}:`)) images.delete(key);
    for (const key of failed.keys()) if (key.startsWith(`${id}:`)) failed.delete(key);
    for (const [key, value] of pending)
      if (key.startsWith(`${id}:`)) {
        value.controller.abort();
        pending.delete(key);
      }
    notify();
  }
  function expire() {
    for (const [id, until] of leases) if (until <= now()) update(id);
  }
  function effective(id: string, ref: AvatarRef): AvatarRef | null {
    if (!active || id !== viewer || (leases.get(ref.userId) ?? Infinity) <= now()) return null;
    const state = latest.get(ref.userId);
    return state ? state.avatarRef : ref;
  }
  return {
    setViewer,
    update,
    currentRef: effective,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    snapshot: () => version,
    key(id: string, ref: AvatarRef) {
      const current = effective(id, ref);
      return `${id}:${ref.userId}:${ref.revision}:${current?.revision ?? 'none'}:${epoch}:${generations.get(ref.userId) ?? 0}`;
    },
    setActive(value: boolean) {
      if (active === value) return;
      active = value;
      clearBytes();
      notify();
    },
    clear() {
      clearBytes();
      notify();
    },
    watch(id: string, ref: AvatarRef, resolveFirst = false) {
      if (viewer !== id) setViewer(id);
      const token = Symbol();
      const set = watches.get(ref.userId) ?? new Map<symbol, AvatarRef>();
      set.set(token, ref);
      watches.set(ref.userId, set);
      const current = latest.get(ref.userId);
      if (!current || ref.revision > current.revision) {
        const retained = [...images.entries()].find(
          ([key, value]) =>
            key.startsWith(`${ref.userId}:`) &&
            value.expires > now() &&
            Number(key.slice(ref.userId.length + 1)) >= ref.revision,
        );
        if (!current && retained) {
          const restored = {
            userId: ref.userId,
            revision: Number(retained[0].slice(ref.userId.length + 1)),
          };
          latest.set(ref.userId, { revision: restored.revision, avatarRef: restored });
          leases.set(ref.userId, retained[1].expires);
          bump(ref.userId);
          notify();
        } else update(ref.userId, { revision: ref.revision, avatarRef: resolveFirst ? null : ref });
      }
      return () => {
        const current = watches.get(ref.userId);
        current?.delete(token);
        if (current?.size === 0) {
          watches.delete(ref.userId);
          latest.delete(ref.userId);
          generations.delete(ref.userId);
          leases.delete(ref.userId);
          for (const [key, value] of pending)
            if (key.startsWith(`${ref.userId}:`)) {
              value.controller.abort();
              pending.delete(key);
            }
        }
      };
    },
    async load(id: string, supplied: AvatarRef): Promise<string | null> {
      expire();
      const ref = effective(id, supplied);
      if (!ref) return null;
      const key = `${ref.userId}:${ref.revision}`;
      if ((failed.get(key) ?? 0) > now()) return null;
      const cached = images.get(key);
      if (cached && cached.expires > now()) {
        images.delete(key);
        images.set(key, cached);
        return cached.uri;
      }
      if (pending.has(key)) return pending.get(key)!.promise;
      const controller = new AbortController();
      const expires = now() + AVATAR_AUTH_LEASE_MS;
      const capturedEpoch = epoch;
      const generation = generations.get(ref.userId);
      const promise = loader
        .getAvatar(id, ref, controller.signal)
        .then((uri) => {
          if (
            expires <= now() ||
            !active ||
            controller.signal.aborted ||
            viewer !== id ||
            epoch !== capturedEpoch ||
            generations.get(ref.userId) !== generation
          )
            return null;
          images.set(key, { uri, expires });
          leases.set(ref.userId, expires);
          let size = [...images.values()].reduce((sum, value) => sum + value.uri.length, 0);
          while (images.size > 32 || size > 8 * 1024 * 1024) {
            const oldest = images.keys().next().value!;
            size -= images.get(oldest)!.uri.length;
            images.delete(oldest);
          }
          return uri;
        })
        .catch((error) => {
          if (
            !controller.signal.aborted &&
            viewer === id &&
            epoch === capturedEpoch &&
            generations.get(ref.userId) === generation
          ) {
            if (denied(error)) update(ref.userId);
            failed.set(key, now() + 15_000);
          }
          return null;
        })
        .finally(() => {
          if (pending.get(key)?.controller === controller) pending.delete(key);
        });
      pending.set(key, { controller, promise });
      return promise;
    },
    async revalidate() {
      expire();
      if (!viewer || !active || manifest || !watches.size) return;
      const id = viewer;
      const capturedEpoch = epoch;
      const ids = [...watches.keys()];
      const captured = new Map(ids.map((target) => [target, generations.get(target)]));
      const controller = new AbortController();
      manifest = controller;
      try {
        for (let offset = 0; offset < ids.length; offset += 100) {
          const batch = ids.slice(offset, offset + 100);
          const expires = now() + AVATAR_AUTH_LEASE_MS;
          const states = await loader.resolveAvatarRefs(id, batch, controller.signal);
          if (controller.signal.aborted || viewer !== id || epoch !== capturedEpoch) return;
          if (expires <= now()) {
            expire();
            continue;
          }
          for (const target of batch) {
            if (!watches.has(target) || generations.get(target) !== captured.get(target)) continue;
            const previous = latest.get(target);
            const next = states[target] ?? { revision: previous?.revision ?? 0, avatarRef: null };
            if (next.revision !== previous?.revision || !!next.avatarRef !== !!previous?.avatarRef)
              update(target, next, true);
            else {
              if (next.avatarRef) leases.set(target, expires);
              const key = `${target}:${next.revision}`;
              const retry = failed.get(key);
              if (next.avatarRef && retry !== undefined && retry <= now()) {
                update(target, next, true);
                continue;
              }
              const image = images.get(key);
              if (image) image.expires = expires;
            }
          }
        }
      } catch (error) {
        if (denied(error) && !controller.signal.aborted && viewer === id && epoch === capturedEpoch)
          ids.forEach((target) => {
            if (generations.get(target) === captured.get(target)) update(target);
          });
      } finally {
        if (manifest === controller) manifest = null;
      }
    },
  };
}
