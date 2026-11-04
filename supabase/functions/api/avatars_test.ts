import jpeg from 'jpeg-js';
import { createApp } from './app.ts';
import { createAvatarStore, deleteAccountPhotos } from './avatarStore.ts';
import { normalizeAvatar } from './avatarImage.ts';
import { ApiError } from '../_shared/api/errors.ts';
import { AVATAR_MAX_BYTES, readAvatarBody, type AvatarStore } from '../_shared/api/avatars.ts';
import type { createServiceClient } from './serviceClient.ts';

function assert(value: unknown, message = 'Assertion failed'): asserts value {
  if (!value) throw new Error(message);
}
async function rejects(fn: () => unknown, code?: string) {
  try {
    await fn();
  } catch (error) {
    if (code) assert(error instanceof ApiError && error.code === code);
    return;
  }
  throw new Error('Expected rejection');
}
const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
function image(width = 16, height = width) {
  return new Uint8Array(
    jpeg.encode({ width, height, data: new Uint8Array(width * height * 4).fill(200) }, 80).data,
  );
}

Deno.test(
  'real JPEG decoding bounds dimensions and rejects forged/truncated image contents',
  async () => {
    const result = normalizeAvatar(image());
    assert(jpeg.decode(result).width === 16);
    normalizeAvatar(image(512));
    for (const bytes of [
      new Uint8Array(),
      new TextEncoder().encode('not a JPEG'),
      new Uint8Array([255, 216, 1, 2, 3]),
      image(513),
      image(20, 10),
      new Uint8Array(AVATAR_MAX_BYTES + 1),
    ]) {
      await rejects(() => normalizeAvatar(bytes), 'INVALID_IMAGE');
    }
  },
);

Deno.test('JPEG normalization strips source comments and metadata', () => {
  const source = jpeg.encode(
    { width: 8, height: 8, data: new Uint8Array(8 * 8 * 4), comments: ['PRIVATE-GPS-SECRET'] },
    80,
  ).data;
  assert(jpeg.decode(source).comments?.includes('PRIVATE-GPS-SECRET'));
  const decoded = jpeg.decode(normalizeAvatar(new Uint8Array(source)));
  assert(!decoded.comments?.length && !Reflect.get(decoded, 'exifBuffer'));
});

Deno.test(
  'bounded streaming reader rejects oversized, empty, and non-JPEG bodies without trusting length',
  async () => {
    const req = (body: BodyInit | null, type = 'image/jpeg') =>
      new Request('https://test/me/avatar', {
        method: 'POST',
        headers: { 'Content-Type': type },
        body,
      });
    const bytes = image();
    assert((await readAvatarBody(req(bytes))).length === bytes.length);
    await rejects(() => readAvatarBody(req(null)), 'INVALID_IMAGE');
    await rejects(() => readAvatarBody(req(bytes, 'image/png')), 'INVALID_IMAGE');
    let canceled = false;
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array(AVATAR_MAX_BYTES));
        c.enqueue(new Uint8Array(1));
      },
      cancel() {
        canceled = true;
      },
    });
    await rejects(() => readAvatarBody(req(stream)), 'IMAGE_TOO_LARGE');
    assert(canceled);
  },
);

function fakeClient() {
  const calls: string[] = [];
  const objects = new Map<string, Uint8Array>();
  let path: string | null = `${owner}/previous.jpg`;
  let revision = 0;
  let deleting = false;
  let failUpload = false;
  let failCleanup = false;
  let revokeOnDownload = false;
  let loseCommitReply = false;
  objects.set(path, image());
  const client = {
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push(name);
      if (name === 'consume_avatar_limit') return { data: true, error: null };
      if (name === 'avatar_cleanup_claim') return { data: 'claim', error: null };
      if (name === 'avatar_cleanup_finish') return { data: null, error: null };
      if (name === 'avatar_orphans')
        return { data: [...objects.keys()].filter((key) => key !== path), error: null };
      if (name === 'avatar_begin_account_delete') {
        deleting = true;
        revision++;
        return { error: null };
      }
      if (name === 'avatar_read') {
        return args.p_revision === revision && !deleting && path
          ? { data: path, error: null }
          : { data: null, error: { code: 'PT404' } };
      }
      if (deleting || args.p_revision !== revision) return { data: null, error: { code: 'PT409' } };
      if (name === 'avatar_change') {
        const previousPath = path;
        path = args.p_path as string | null;
        revision++;
        if (loseCommitReply) return { data: null, error: { code: '08006' } };
        return {
          data: { previousPath, revision, avatarRef: path ? { userId: owner, revision } : null },
          error: null,
        };
      }
      return { error: null };
    },
    storage: {
      from(bucket: string) {
        assert(bucket === 'profile-photos');
        return {
          async upload(key: string, bytes: Uint8Array, options: { upsert: boolean }) {
            calls.push('upload');
            assert(!options.upsert && key.startsWith(`${owner}/`));
            if (!failUpload) objects.set(key, bytes);
            return { error: failUpload ? {} : null };
          },
          async remove(keys: string[]) {
            calls.push('remove');
            if (!failCleanup) keys.forEach((key) => objects.delete(key));
            return { error: failCleanup ? {} : null };
          },
          async download(key: string) {
            calls.push('download');
            if (revokeOnDownload) deleting = true;
            return { data: new Blob([new Uint8Array(objects.get(key)!).buffer]), error: null };
          },
          async list() {
            return {
              data: [...objects.keys()].map((key) => ({ name: key.split('/')[1] })),
              error: null,
            };
          },
        };
      },
    },
  } as unknown as ReturnType<typeof createServiceClient>;
  return {
    client,
    calls,
    objects,
    get path() {
      return path;
    },
    set failUpload(v: boolean) {
      failUpload = v;
    },
    set failCleanup(v: boolean) {
      failCleanup = v;
    },
    set revokeOnDownload(v: boolean) {
      revokeOnDownload = v;
    },
    set loseCommitReply(v: boolean) {
      loseCommitReply = v;
    },
  };
}

Deno.test(
  'replacement uploads immutable canonical bytes before CAS and removes only the previous image',
  async () => {
    const f = fakeClient();
    const store = createAvatarStore(() => f.client);
    const result = await store.upload(owner, 0, image());
    assert(result.revision === 1 && result.avatarRef?.userId === owner);
    assert(f.objects.size === 1 && f.objects.has(f.path!));
    assert(f.calls.join(',') === 'avatar_prepare,upload,avatar_change,remove');
    await rejects(() => store.upload(owner, 0, image()), 'PHOTO_CONFLICT');
    assert(f.objects.size === 1);
    assert((await store.remove(owner, 1)).avatarRef === null && Number(f.objects.size) === 0);
  },
);

Deno.test(
  'failed upload preserves old photo; uncertain commit never deletes a potentially active candidate',
  async () => {
    const f = fakeClient();
    const store = createAvatarStore(() => f.client);
    const old = f.path;
    f.failUpload = true;
    await rejects(() => store.upload(owner, 0, image()));
    assert(f.path === old && f.objects.has(old!));
    f.failUpload = false;
    f.loseCommitReply = true;
    await rejects(() => store.upload(owner, 0, image()));
    assert(f.path !== old && f.objects.has(f.path!));
    await store.cleanup();
    assert(f.objects.size === 1 && f.objects.has(f.path!));
  },
);

Deno.test(
  'concurrent replacements have a single winner and leave the loser safe for orphan collection',
  async () => {
    const f = fakeClient();
    const store = createAvatarStore(() => f.client);
    const results = await Promise.allSettled([
      store.upload(owner, 0, image()),
      store.upload(owner, 0, image()),
    ]);
    assert(results.filter((r) => r.status === 'fulfilled').length === 1);
    assert(results.filter((r) => r.status === 'rejected').length === 1);
    assert(f.objects.has(f.path!));
    await store.cleanup();
    assert(f.objects.size === 1 && f.objects.has(f.path!));
  },
);

Deno.test('cleanup failure does not report a committed replace/remove as failed', async () => {
  const f = fakeClient();
  const store = createAvatarStore(() => f.client);
  f.failCleanup = true;
  assert((await store.upload(owner, 0, image())).revision === 1);
  assert((await store.remove(owner, 1)).avatarRef === null);
  f.failCleanup = false;
  await store.cleanup();
  assert(Number(f.objects.size) === 0);
});

Deno.test(
  'photo read reauthorizes after download and rejects access revoked during I/O',
  async () => {
    const f = fakeClient();
    const store = createAvatarStore(() => f.client);
    assert((await store.read(owner, owner, 0)).length > 0);
    f.revokeOnDownload = true;
    await rejects(() => store.read(owner, owner, 0), 'PHOTO_UNAVAILABLE');
  },
);

Deno.test(
  'account cleanup freezes mutations, removes objects, and remains retryable after Storage failure',
  async () => {
    const f = fakeClient();
    f.failCleanup = true;
    await rejects(() => deleteAccountPhotos(owner, f.client));
    await rejects(
      () => createAvatarStore(() => f.client).upload(owner, 0, image()),
      'PHOTO_CONFLICT',
    );
    f.failCleanup = false;
    await deleteAccountPhotos(owner, f.client);
    assert(Number(f.objects.size) === 0);
  },
);

Deno.test('every photo verb authenticates before any storage operation', async () => {
  const forbidden = new Proxy({} as AvatarStore, {
    get() {
      throw new Error('Storage touched before auth');
    },
  });
  const app = setup(forbidden, false);
  for (const [method, path] of [
    ['POST', '/me/avatar?revision=0'],
    ['DELETE', '/me/avatar?revision=0'],
    ['GET', `/users/${other}/avatar?revision=0`],
  ]) {
    const response = await app.request(path!, { method });
    assert(response.status === 401);
    await response.arrayBuffer();
  }
});

function setup(photos: AvatarStore, signedIn = true) {
  const unexpected = new Proxy({} as never, {
    get() {
      throw new Error('Unexpected dependency');
    },
  });
  return createApp({
    store: unexpected,
    closingStore: unexpected,
    lifecycleStore: unexpected,
    poolBuilder: unexpected,
    avatarStore: photos,
    getUser: async () => {
      if (!signedIn) throw new ApiError(401, 'UNAUTHORIZED', 'Sign in');
      return { id: owner };
    },
  });
}

Deno.test(
  'batch photo resolution verifies the viewer, validates IDs and caps batch size',
  async () => {
    const calls: unknown[] = [];
    const photos: AvatarStore = {
      upload: async () => {
        throw new Error('Unexpected upload');
      },
      remove: async () => {
        throw new Error('Unexpected removal');
      },
      read: async () => {
        throw new Error('Unexpected image read');
      },
      cleanup: async () => {},
      resolve: async (viewer, ids) => {
        calls.push([viewer, ids]);
        return { [owner]: { revision: 1, avatarRef: { userId: owner, revision: 1 } } };
      },
    };
    const app = setup(photos);
    const options = (body: unknown) => ({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const response = await app.request(
      '/avatars/resolve',
      options({ userIds: [owner, owner], viewerId: other }),
    );
    assert(
      response.status === 200 && response.headers.get('Cache-Control') === 'private, no-store',
    );
    await response.json();
    assert(JSON.stringify(calls) === JSON.stringify([[owner, [owner]]]));
    for (const body of [
      null,
      {},
      { userIds: ['invalid'] },
      { userIds: [null] },
      { userIds: Array(101).fill(owner) },
    ]) {
      const invalid = await app.request('/avatars/resolve', options(body));
      assert(invalid.status === 400);
      await invalid.arrayBuffer();
    }
    const denied = await setup(photos, false).request(
      '/avatars/resolve',
      options({ userIds: [owner] }),
    );
    assert(denied.status === 401 && calls.length === 1);
    await denied.arrayBuffer();
  },
);
Deno.test(
  'photo routes derive ownership from verified auth and return private JPEG bytes',
  async () => {
    const seen: unknown[] = [];
    const photos: AvatarStore = {
      upload: async (...args) => {
        seen.push(args.slice(0, 2));
        return { revision: 1, avatarRef: { userId: owner, revision: 1 } };
      },
      remove: async (...args) => {
        seen.push(args);
        return { revision: 2, avatarRef: null };
      },
      read: async (...args) => {
        seen.push(args);
        return image();
      },
      cleanup: async () => {},
    };
    const app = setup(photos);
    const response = await app.request(`/me/avatar?revision=0&userId=${other}`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/jpeg' },
      body: image(),
    });
    assert(response.status === 200 && JSON.stringify(seen[0]) === JSON.stringify([owner, 0]));
    const read = await app.request(`/users/${other}/avatar?revision=1`, {
      headers: { Authorization: 'Bearer token' },
    });
    assert(read.status === 200 && read.headers.get('Cache-Control') === 'private, no-store');
    assert(
      read.headers.get('Content-Type') === 'image/jpeg' &&
        read.headers.get('Vary')?.includes('Authorization'),
    );
    assert(JSON.stringify(seen[1]) === JSON.stringify([owner, other, 1]));
    await read.arrayBuffer();
    assert((await app.request('/me/avatar?revision=1', { method: 'DELETE' })).status === 200);
    assert((await app.request('/me/avatar?revision=-1', { method: 'DELETE' })).status === 400);
    const denied = await setup(photos, false).request(`/users/${other}/avatar?revision=1`);
    assert(denied.status === 401 && denied.headers.get('Cache-Control') === 'private, no-store');
  },
);

Deno.test(
  'photo read quotas deny before protected I/O and cleanup skips unclaimed scans',
  async () => {
    const f = fakeClient();
    const deniedClient = {
      ...f.client,
      rpc: async (name: string) => {
        if (name === 'consume_avatar_limit') return { data: false, error: null };
        throw new Error('Unexpected I/O');
      },
    } as unknown as ReturnType<typeof createServiceClient>;
    const store = createAvatarStore(() => deniedClient);
    await rejects(() => store.read(owner, owner, 0), 'PHOTO_RATE_LIMITED');
    await rejects(() => store.resolve!(owner, [owner]), 'PHOTO_RATE_LIMITED');
    assert(!f.calls.includes('avatar_read') && !f.calls.includes('download'));
    const skip = {
      ...f.client,
      rpc: async (name: string) => {
        assert(name === 'avatar_cleanup_claim', 'Unclaimed cleanup scanned Storage');
        return { data: null, error: null };
      },
    } as unknown as ReturnType<typeof createServiceClient>;
    await createAvatarStore(() => skip).cleanup();
  },
);

Deno.test(
  'photo maintenance failure preserves deadline/cache results and retries account cleanup',
  async () => {
    let retried = false;
    const app = createApp({
      store: {} as never,
      lifecycleStore: {} as never,
      poolBuilder: {} as never,
      closingStore: {} as never,
      getUser: async () => ({ id: owner }),
      cronSecret: 'test-only',
      sweepStore: { expiredPage: async () => [] },
      cacheCleanupStore: { deleteExpiredOnce: async () => ({ ran: true, removed: 2 }) },
      avatarStore: {
        upload: async () => {
          throw new Error('Unexpected upload');
        },
        remove: async () => {
          throw new Error('Unexpected removal');
        },
        read: async () => {
          throw new Error('Unexpected read');
        },
        cleanup: async () => {
          throw new Error('Storage unavailable');
        },
      },
      retryAccountDeletions: async () => {
        retried = true;
        return { attempted: 1, failed: 1 };
      },
    });
    const response = await app.request('/internal/sweep', {
      method: 'POST',
      headers: { 'x-cron-secret': 'test-only' },
    });
    const result = await response.json();
    assert(response.status === 200 && result.status === 'ok');
    assert(result.avatarCleanup === 'partial_failure' && result.cacheCleanup.removed === 2);
    assert(retried && result.accountDeletionCleanup.failed === 1);
  },
);

Deno.test(
  'Storage missing/denied responses differ from transient server and transport failures',
  async () => {
    for (const [storageStatus, expected] of [
      [404, 404],
      [403, 404],
      [401, 404],
      [500, 503],
      [503, 503],
      [0, 503],
    ]) {
      const f = fakeClient();
      const client = {
        ...f.client,
        storage: {
          from: () => ({
            download: async () => {
              if (!storageStatus) throw new Error('PRIVATE transport details');
              return {
                data: null,
                error: { statusCode: String(storageStatus), message: 'PRIVATE' },
              };
            },
          }),
        },
      } as unknown as ReturnType<typeof createServiceClient>;
      try {
        await createAvatarStore(() => client).read(owner, owner, 0);
        throw new Error('Expected rejection');
      } catch (error) {
        assert(error instanceof ApiError && error.status === expected);
        assert(!error.message.includes('PRIVATE'));
      }
    }
  },
);

Deno.test(
  'actual deletion adapter retries a partially removed Storage prefix while keeping writes frozen',
  async () => {
    const f = fakeClient();
    const bucket = f.client.storage.from('profile-photos');
    let partial = true;
    const client = {
      ...f.client,
      storage: {
        from: () => ({
          ...bucket,
          remove: async (keys: string[]) => {
            if (partial) {
              partial = false;
              await bucket.remove(keys.slice(0, 1));
              return { error: { message: 'lost response after partial removal' } };
            }
            return bucket.remove(keys);
          },
        }),
      },
    } as unknown as ReturnType<typeof createServiceClient>;
    // Two objects ensure retry really encounters a remaining object.
    await bucket.upload(`${owner}/orphan.jpg`, image(), { upsert: false });
    await rejects(() => deleteAccountPhotos(owner, client));
    assert(f.objects.size === 1);
    await rejects(() => createAvatarStore(() => client).read(owner, owner, 0), 'PHOTO_UNAVAILABLE');
    await deleteAccountPhotos(owner, client);
    assert(Number(f.objects.size) === 0);
  },
);
