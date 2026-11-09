import { createApp } from './app.ts';
import { sameBirthday } from '../_shared/api/birthdays.ts';
import { ApiError } from '../_shared/api/errors.ts';
function assert(value: unknown): asserts value {
  if (!value) throw new Error('Assertion failed');
}
const owner = 'b0380001-3333-4333-8333-333333333333';
const stranger = 'b0380003-3333-4333-8333-333333333333';
Deno.test(
  'birthday writes authenticate, validate and bind to verified owner, never request-body IDs',
  async () => {
    let auth = true,
      writes = 0;
    const profile = {
      id: owner,
      displayName: 'Ava',
      username: 'ava',
      avatarUrl: null,
      isOwner: true,
      metadataVisible: true,
      friendsCount: 0,
      groupsCount: 0,
      favoriteCuisine: null,
      favoriteActivity: null,
      mutualGroups: [],
    };
    const app = createApp({
      store: {} as never,
      lifecycleStore: {} as never,
      closingStore: {} as never,
      poolBuilder: {} as never,
      getUser: async () => {
        if (!auth) throw new ApiError(401, 'UNAUTHORIZED', 'Sign in');
        return { id: owner };
      },
      userProfilesStore: {
        get: async (viewer, target) => {
          assert(viewer === owner && target === owner);
          return { ...profile, birthday: { month: 2, day: 29 }, shareBirthday: false };
        },
        update: async (id, input) => {
          assert(
            id === owner &&
              (input.birthday === null || sameBirthday(input.birthday, { month: 2, day: 29 })) &&
              input.shareBirthday === false,
          );
          writes++;
          return { ...profile, ...input };
        },
        completeIdentity: async (id, input) => {
          assert(
            id === owner &&
              (input.birthday === null || sameBirthday(input.birthday, { month: 2, day: 29 })),
          );
          writes++;
          return { ...profile, birthday: input.birthday, birthdayRequired: false };
        },
      },
    });
    const post = (path: string, body: unknown) =>
      app.request(path, { method: 'POST', body: JSON.stringify(body) });
    const body = {
      username: 'ava',
      displayName: 'Ava',
      shareMetadata: false,
      shareBirthday: false,
      birthday: { month: 2, day: 29 },
      userId: stranger,
    };
    for (const birthday of [
      { month: 2, day: 30 },
      { month: 4, day: 31 },
      { month: 2, day: 29, year: 2000 },
      '2000-02-29',
    ]) {
      assert((await post('/me/details', { ...body, birthday })).status === 400);
      assert((await post('/me/identity', { ...body, birthday })).status === 400);
    }
    assert(writes === 0);
    for (const path of ['/me/details', '/me/identity']) {
      const response = await post(path, body);
      assert(
        response.status === 200 && response.headers.get('Cache-Control') === 'private, no-store',
      );
      assert(sameBirthday((await response.json()).birthday, { month: 2, day: 29 }));
    }
    assert(Number(writes) === 2);
    // Skip and owner removal both accept null, without weakening authentication.
    for (const path of ['/me/identity', '/me/details']) {
      const response = await post(path, { ...body, birthday: null });
      assert(response.status === 200);
      assert((await response.json()).birthday === null);
    }
    assert(Number(writes) === 4);
    auth = false;
    assert((await post('/me/details', body)).status === 401);
    assert((await post('/me/identity', body)).status === 401);
    assert((await app.request('/me/details')).status === 401);
  },
);
