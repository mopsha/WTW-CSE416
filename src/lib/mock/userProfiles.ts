import type { Birthday } from '@shared/api/birthdays.ts';
import { ApiError } from '@shared/api/errors.ts';
import {
  parseIdentity,
  parseProfileDetails,
  type ProfileDetailsInput,
  type UserProfile,
} from '@shared/api/userProfiles.ts';
import { MOCK_USER_ID, mockUsernameTaken } from './auth';
import { mockProfile, mockBlocks, mockPicks } from './store';
import {
  AVATAR_MAX_BYTES,
  parseAvatarRevision,
  type AvatarChange,
  type AvatarRef,
} from '@shared/api/avatars.ts';
import { photoBytes, photoBase64 } from '../photoBytes';
import { mockFriendsList } from './friends';
import { mockAllGroupRecords } from './groups';
export const mockBirthdays = new Map<string, { birthday: Birthday; shareBirthday: boolean }>();
const empty = (): ProfileDetailsInput => ({
  username: null,
  favoriteCuisine: null,
  favoriteActivity: null,
  shareMetadata: false,
});
export const mockUserProfiles = new Map<
  string,
  ProfileDetailsInput & {
    avatarUrl?: string | null;
    avatarRevision?: number;
    avatarData?: string | null;
  }
>([
  [
    'mock-jordan',
    { username: 'jordan', favoriteCuisine: null, favoriteActivity: null, shareMetadata: false },
  ],
  [
    'mock-dana',
    { username: 'dana', favoriteCuisine: null, favoriteActivity: null, shareMetadata: false },
  ],
  [
    'mock-ava',
    {
      username: 'ava',
      favoriteCuisine: 'Japanese',
      favoriteActivity: 'Climbing',
      shareMetadata: true,
    },
  ],
  [
    'mock-ben',
    {
      username: 'ben',
      favoriteCuisine: 'Italian',
      favoriteActivity: 'Basketball',
      shareMetadata: false,
    },
  ],
  [
    'mock-cam',
    { username: 'cam', favoriteCuisine: null, favoriteActivity: null, shareMetadata: true },
  ],
]);
export const resetOwnMockUserProfile = () => {
  mockUserProfiles.delete(MOCK_USER_ID);
  mockBirthdays.delete(MOCK_USER_ID);
};
export function getMockUserProfile(targetId: string): UserProfile {
  const own = targetId === MOCK_USER_ID;
  const friend = mockFriendsList().friends.find((f) => f.userId === targetId);
  if (!own && (!friend || mockBlocks.has(targetId)))
    throw new ApiError(404, 'PROFILE_NOT_FOUND', 'Profile not found');
  const p: ProfileDetailsInput & { avatarUrl?: string | null } =
    mockUserProfiles.get(targetId) ?? empty();
  const visible = own || p.shareMetadata;
  const groups = mockAllGroupRecords().filter((g) => g.memberIds.includes(targetId));
  return {
    id: targetId,
    displayName: own ? mockProfile.displayName : friend!.displayName,
    username: p.username,
    avatarUrl: p.avatarUrl ?? null,
    avatarRef: mockAvatarRef(MOCK_USER_ID, targetId),
    ...(own ? { avatarRevision: mockUserProfiles.get(targetId)?.avatarRevision ?? 0 } : {}),
    ...(own
      ? {
          birthday: mockBirthdays.get(targetId)?.birthday ?? null,
          shareBirthday: mockBirthdays.get(targetId)?.shareBirthday ?? false,
          birthdayRequired: mockProfile.birthdayRequired,
        }
      : mockBirthdays.get(targetId)?.shareBirthday
        ? { birthday: mockBirthdays.get(targetId)!.birthday }
        : {}),
    isOwner: own,
    metadataVisible: visible,
    ...(own ? { shareMetadata: p.shareMetadata } : {}),
    friendsCount: visible ? (own ? mockFriendsList().friends.length : 1) : null,
    groupsCount: visible ? groups.length : null,
    favoriteCuisine: visible ? p.favoriteCuisine : null,
    favoriteActivity: visible ? p.favoriteActivity : null,
    mutualGroups:
      visible && !own
        ? groups
            .filter((g) => g.memberIds.includes(MOCK_USER_ID))
            .map((g) => ({ id: g.id, name: g.name }))
            .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
        : [],
  };
}

export function mockCanViewAvatar(viewer: string, target: string): boolean {
  if (
    (viewer === MOCK_USER_ID && mockBlocks.has(target)) ||
    (target === MOCK_USER_ID && mockBlocks.has(viewer))
  )
    return false;
  if (viewer === target) return true;
  const peer = viewer === MOCK_USER_ID ? target : target === MOCK_USER_ID ? viewer : null;
  if (peer && mockFriendsList().friends.some((friend) => friend.userId === peer)) return true;
  return (
    mockAllGroupRecords().some(
      (group) => group.memberIds.includes(viewer) && group.memberIds.includes(target),
    ) ||
    [...mockPicks.values()].some(
      (pick) =>
        ['draft', 'swiping', 'ranking', 'final_vote'].includes(pick.state) &&
        pick.participants.some((p) => p.userId === viewer) &&
        pick.participants.some((p) => p.userId === target),
    )
  );
}
export function mockAvatarRef(viewer: string, target: string): AvatarRef | null {
  const p = mockUserProfiles.get(target);
  return p?.avatarData && mockCanViewAvatar(viewer, target)
    ? { userId: target, revision: p.avatarRevision ?? 0 }
    : null;
}

/** Uses the existing profile map, not a second avatar/identity store. This mock
 * validates the transport shape; actual JPEG decoding is tested on the backend. */
export function handleMockAvatarRequest(
  method: string,
  path: string,
  init: RequestInit,
): Response | null {
  const url = new URL(path, 'https://mock.wtw.local');
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' };
  if (method === 'GET' && url.pathname === '/avatars/capabilities')
    return new Response(JSON.stringify({ uploadsEnabled: false, reportsEnabled: false }), {
      status: 200,
      headers,
    });
  const target = /^\/users\/([^/]+)\/avatar$/.exec(url.pathname);
  if (method === 'POST' && url.pathname === '/avatars/resolve') {
    const input = JSON.parse(String(init.body)) as { userIds?: unknown };
    if (
      !Array.isArray(input.userIds) ||
      input.userIds.length > 100 ||
      input.userIds.some((id) => typeof id !== 'string')
    )
      throw new ApiError(400, 'INVALID_INPUT', 'Expected up to 100 user IDs');
    const states: Record<string, AvatarChange> = {};
    for (const id of input.userIds as string[])
      if (mockCanViewAvatar(MOCK_USER_ID, id))
        states[id] = {
          revision: mockUserProfiles.get(id)?.avatarRevision ?? 0,
          avatarRef: mockAvatarRef(MOCK_USER_ID, id),
        };
    return new Response(JSON.stringify(states), { headers });
  }
  if (!target && url.pathname !== '/me/avatar') return null;
  const revision = parseAvatarRevision(url.searchParams.get('revision'));
  if (method === 'GET' && target) {
    const id = decodeURIComponent(target[1]!);
    const p = mockUserProfiles.get(id);
    if (!p?.avatarData || p.avatarRevision !== revision || !mockCanViewAvatar(MOCK_USER_ID, id))
      throw new ApiError(404, 'PHOTO_UNAVAILABLE', 'Photo unavailable');
    return new Response(new Uint8Array(photoBytes(p.avatarData)).buffer, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'private, no-store',
        Vary: 'Authorization',
      },
    });
  }
  if (url.pathname !== '/me/avatar' || !['POST', 'DELETE'].includes(method)) return null;
  const current = mockUserProfiles.get(MOCK_USER_ID) ?? empty();
  const currentRevision = mockUserProfiles.get(MOCK_USER_ID)?.avatarRevision ?? 0;
  if (revision !== currentRevision)
    throw new ApiError(409, 'PHOTO_CONFLICT', 'Photo changed; reload before retrying');
  let data: string | null = null;
  if (method === 'POST') {
    if (
      new Headers(init.headers).get('Content-Type') !== 'image/jpeg' ||
      !(init.body instanceof ArrayBuffer)
    )
      throw new ApiError(400, 'INVALID_IMAGE', 'Expected a JPEG photo');
    const bytes = new Uint8Array(init.body);
    if (!bytes.length || bytes.length > AVATAR_MAX_BYTES || bytes[0] !== 255 || bytes[1] !== 216)
      throw new ApiError(400, 'INVALID_IMAGE', 'Invalid JPEG photo');
    // Keep byte conversion shared with the real client; never write mock photos to disk.
    data = photoBase64(bytes);
  }
  mockUserProfiles.set(MOCK_USER_ID, {
    ...current,
    avatarUrl: null,
    avatarData: data,
    avatarRevision: revision + 1,
  });
  const result: AvatarChange = {
    revision: revision + 1,
    avatarRef: mockAvatarRef(MOCK_USER_ID, MOCK_USER_ID),
  };
  return new Response(JSON.stringify(result), { headers });
}
export function handleMockUserProfiles(method: string, path: string, body: unknown) {
  const target = /^\/users\/([^/]+)\/profile$/.exec(path);
  if (method === 'GET' && (path === '/me/details' || target))
    return getMockUserProfile(target ? decodeURIComponent(target[1]!) : MOCK_USER_ID);
  if (method === 'POST' && (path === '/me/details' || path === '/me/identity')) {
    const identity = path === '/me/identity' ? parseIdentity(body) : null;
    const input = identity
      ? { ...(mockUserProfiles.get(MOCK_USER_ID) ?? empty()), username: identity.username }
      : parseProfileDetails(body, mockUserProfiles.get(MOCK_USER_ID)?.username);
    if (mockUserProfiles.get(MOCK_USER_ID)?.username && !input.username)
      throw new ApiError(400, 'INVALID_INPUT', 'Username is required');
    if (
      input.username &&
      (mockUsernameTaken(input.username) ||
        [...mockUserProfiles].some(
          ([id, p]) => id !== MOCK_USER_ID && p.username === input.username,
        ))
    )
      throw new ApiError(409, 'USERNAME_TAKEN', 'That username is already taken');
    const { birthday, shareBirthday, ...metadata } = input;
    const current = mockBirthdays.get(MOCK_USER_ID);
    const chosenBirthday =
      identity && 'birthday' in identity
        ? identity.birthday
        : 'birthday' in input
          ? birthday
          : current?.birthday;
    const sharing = shareBirthday ?? current?.shareBirthday ?? false;
    if (!chosenBirthday && sharing)
      throw new ApiError(400, 'INVALID_BIRTHDAY', 'Add a birthday before sharing it');
    if (chosenBirthday) {
      mockBirthdays.set(MOCK_USER_ID, { birthday: chosenBirthday, shareBirthday: sharing });
      mockProfile.birthdayRequired = false;
    } else {
      mockBirthdays.delete(MOCK_USER_ID);
      mockProfile.birthdayRequired =
        mockProfile.birthdaySetupRequired && mockProfile.optionalSetupPending;
    }
    if (identity) mockProfile.displayName = identity.displayName;
    mockUserProfiles.set(MOCK_USER_ID, { ...mockUserProfiles.get(MOCK_USER_ID), ...metadata });
    return getMockUserProfile(MOCK_USER_ID);
  }
  return null;
}
