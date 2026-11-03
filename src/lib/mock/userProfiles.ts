import { ApiError } from '@shared/api/errors.ts';
import {
  parseIdentity,
  parseProfileDetails,
  type ProfileDetailsInput,
  type UserProfile,
} from '@shared/api/userProfiles.ts';
import { MOCK_USER_ID, mockUsernameTaken } from './auth';
import { mockProfile, mockBlocks } from './store';
import { mockFriendsList } from './friends';
import { mockAllGroupRecords } from './groups';
const empty = (): ProfileDetailsInput => ({
  username: null,
  favoriteCuisine: null,
  favoriteActivity: null,
  shareMetadata: false,
});
export const mockUserProfiles = new Map<
  string,
  ProfileDetailsInput & { avatarUrl?: string | null }
>([
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
export const resetOwnMockUserProfile = () => mockUserProfiles.delete(MOCK_USER_ID);
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
export function handleMockUserProfiles(method: string, path: string, body: unknown) {
  const target = /^\/users\/([^/]+)\/profile$/.exec(path);
  if (method === 'GET' && (path === '/me/details' || target))
    return getMockUserProfile(target ? decodeURIComponent(target[1]!) : MOCK_USER_ID);
  if (method === 'POST' && (path === '/me/details' || path === '/me/identity')) {
    const identity = path === '/me/identity' ? parseIdentity(body) : null;
    const input = identity
      ? { ...(mockUserProfiles.get(MOCK_USER_ID) ?? empty()), username: identity.username }
      : parseProfileDetails(body);
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
    if (identity) mockProfile.displayName = identity.displayName;
    mockUserProfiles.set(MOCK_USER_ID, { ...mockUserProfiles.get(MOCK_USER_ID), ...input });
    return getMockUserProfile(MOCK_USER_ID);
  }
  return null;
}
