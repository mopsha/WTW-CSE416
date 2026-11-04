import { createAvatarCache } from '@/lib/avatarCache';
import type { AvatarRef, AvatarChange } from '@shared/api/avatars.ts';
const ref = { userId: 'friend', revision: 1 };
function fixture() {
  let clock = 100;
  const loader = {
    getAvatar: jest
      .fn<Promise<string>, [string, AvatarRef, AbortSignal]>()
      .mockImplementation(async (viewer, photo) => `${viewer}:photo-${photo.revision}`),
    resolveAvatarRefs: jest
      .fn<Promise<Record<string, AvatarChange>>, [string, string[], AbortSignal]>()
      .mockResolvedValue({ friend: { revision: 1, avatarRef: ref } }),
  };
  const cache = createAvatarCache(loader, () => clock);
  cache.watch('A', ref);
  return {
    cache,
    loader,
    setClock: (value: number) => {
      clock = value;
    },
  };
}
test('deduplicates downloads and uses only unexpired account-scoped cache entries', async () => {
  const { cache, loader, setClock } = fixture();
  await Promise.all([cache.load('A', ref), cache.load('A', ref)]);
  expect(loader.getAvatar).toHaveBeenCalledTimes(1);
  expect(await cache.load('A', ref)).toBe('A:photo-1');
  setClock(16_000);
  await cache.load('A', ref);
  expect(loader.getAvatar).toHaveBeenCalledTimes(2);
  cache.setViewer('B');
  cache.watch('B', ref);
  expect(await cache.load('B', ref)).toBe('B:photo-1');
  expect(loader.getAvatar).toHaveBeenCalledTimes(3);
  cache.setViewer(null);
  expect(await cache.load('A', ref)).toBeNull();
});
test('blocks and removal discard late downloads even when a transport ignores abort', async () => {
  const { cache, loader } = fixture();
  let finish!: (uri: string) => void;
  loader.getAvatar.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = cache.load('A', ref);
  cache.update('friend', { revision: 2, avatarRef: null });
  finish('private-old-photo');
  expect(await pending).toBeNull();
  expect(await cache.load('A', ref)).toBeNull();
  expect(loader.getAvatar.mock.calls[0]?.[2].aborted).toBe(true);
});
test('sign-out and backgrounding invalidate in-flight sources', async () => {
  for (const action of ['sign-out', 'background']) {
    const { cache, loader } = fixture();
    let finish!: (uri: string) => void;
    loader.getAvatar.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const result = cache.load('A', ref);
    if (action === 'sign-out') cache.setViewer(null);
    else cache.setActive(false);
    finish('private');
    expect(await result).toBeNull();
  }
});
test('one batch revalidates identities, updates revisions and revokes denied sources', async () => {
  const { cache, loader } = fixture();
  cache.watch('A', { userId: 'second', revision: 1 });
  await cache.load('A', ref);
  loader.resolveAvatarRefs.mockResolvedValueOnce({
    friend: { revision: 2, avatarRef: { ...ref, revision: 2 } },
  });
  await cache.revalidate();
  expect(loader.resolveAvatarRefs).toHaveBeenCalledTimes(1);
  expect(loader.resolveAvatarRefs.mock.calls[0]?.[1]).toEqual(['friend', 'second']);
  expect(await cache.load('A', ref)).toBe('A:photo-2');
  expect(await cache.load('A', { userId: 'second', revision: 1 })).toBeNull();
});
test('stale visibility replies cannot undo a newer successful replacement', async () => {
  const { cache, loader } = fixture();
  let finish!: (value: Record<string, never>) => void;
  loader.resolveAvatarRefs.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = cache.revalidate();
  cache.update('friend', { revision: 3, avatarRef: { ...ref, revision: 3 } });
  finish({});
  await pending;
  expect(await cache.load('A', ref)).toBe('A:photo-3');
});
test('a new mock account scope can resolve a lower revision despite stale parent props', async () => {
  const { cache, loader } = fixture();
  const stale = { ...ref, revision: 5 };
  cache.watch('A', stale);
  await cache.load('A', stale);
  cache.setViewer('A', 'second@example.com');
  cache.watch('A', stale);
  loader.resolveAvatarRefs.mockResolvedValueOnce({ friend: { revision: 1, avatarRef: ref } });
  await cache.revalidate();
  expect(await cache.load('A', stale)).toBe('A:photo-1');
});
test('unmount/remount cannot make an old visibility response overwrite a new reference', async () => {
  const { loader } = fixture();
  const cache = createAvatarCache(loader);
  const stop = cache.watch('A', ref);
  let finish!: (value: Record<string, AvatarChange>) => void;
  loader.resolveAvatarRefs.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const request = cache.revalidate();
  stop();
  cache.watch('A', { ...ref, revision: 2 });
  finish({ friend: { revision: 1, avatarRef: ref } });
  await request;
  expect(await cache.load('A', { ...ref, revision: 2 })).toBe('A:photo-2');
});
test('visibility failures fail closed and cache count is bounded', async () => {
  const { cache, loader } = fixture();
  await cache.load('A', ref);
  loader.resolveAvatarRefs.mockRejectedValueOnce(new Error('offline'));
  await cache.revalidate();
  expect(await cache.load('A', ref)).toBeNull();
  for (let n = 0; n < 33; n++) {
    const photo = { userId: `person-${n}`, revision: 1 };
    cache.watch('A', photo);
    await cache.load('A', photo);
  }
  const count = loader.getAvatar.mock.calls.length;
  await cache.load('A', { userId: 'person-0', revision: 1 });
  expect(loader.getAvatar).toHaveBeenCalledTimes(count + 1);
});
test('an unavailable image can retry after backoff when visibility is still valid', async () => {
  const { cache, loader, setClock } = fixture();
  loader.getAvatar.mockRejectedValueOnce(new Error('offline'));
  expect(await cache.load('A', ref)).toBeNull();
  expect(await cache.load('A', ref)).toBeNull();
  expect(loader.getAvatar).toHaveBeenCalledTimes(1);
  const before = cache.key('A', ref);
  setClock(16_000);
  await cache.revalidate();
  expect(cache.key('A', ref)).not.toBe(before);
  expect(await cache.load('A', ref)).toBe('A:photo-1');
});
