import { normalizeUsername } from './usernames.ts';
import { parseProfileUpdate, validateDisplayName } from './profile.ts';
import { ApiError } from './errors.ts';
import { requireCleanText } from './text.ts';
import type { AvatarRef } from './avatars.ts';
export interface ProfileDetailsInput {
  username: string | null;
  favoriteCuisine: string | null;
  favoriteActivity: string | null;
  shareMetadata: boolean;
}
export interface UserProfile {
  id: string;
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
  avatarRef?: AvatarRef | null;
  /** Included for the owner even when there is no photo. */
  avatarRevision?: number;
  isOwner: boolean;
  metadataVisible: boolean;
  shareMetadata?: boolean;
  friendsCount: number | null;
  groupsCount: number | null;
  favoriteCuisine: string | null;
  favoriteActivity: string | null;
  mutualGroups: { id: string; name: string }[];
}
export interface IdentityInput {
  displayName: string;
  username: string;
}
export function parseIdentity(body: unknown): IdentityInput {
  const displayName = parseProfileUpdate(body);
  const details = parseProfileDetails({
    ...(body as Record<string, unknown>),
    shareMetadata: false,
  });
  if (!details.username) throw new ApiError(400, 'INVALID_INPUT', 'Choose a username');
  return { displayName, username: details.username };
}
/** Required access depends on identity, never optional survey/permission state. */
export function hasRequiredIdentity(displayName: string | null, username: string | null): boolean {
  return !('error' in validateDisplayName(displayName)) && !!username;
}
export interface UserProfilesStore {
  completeIdentity?(userId: string, input: IdentityInput): Promise<UserProfile>;
  get(viewerId: string, targetId: string): Promise<UserProfile>;
  update(userId: string, input: ProfileDetailsInput): Promise<UserProfile>;
}
export function parseProfileDetails(
  body: unknown,
  currentUsername?: string | null,
): ProfileDetailsInput {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new ApiError(400, 'INVALID_INPUT', 'Expected profile details');
  const b = body as Record<string, unknown>;
  const optionalText = (value: unknown, label: string, max: number) => {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value !== 'string')
      throw new ApiError(400, 'INVALID_INPUT', `${label} must be text`);
    const text = value.trim();
    if ([...text].length > max || /[\u0000-\u001f\u007f]/u.test(text))
      throw new ApiError(
        400,
        'INVALID_INPUT',
        `${label} must be one line, up to ${max} characters`,
      );
    requireCleanText(text, label);
    return text || null;
  };
  const username =
    b.username == null ? null : normalizeUsername(b.username, false, currentUsername);
  if (typeof b.shareMetadata !== 'boolean')
    throw new ApiError(400, 'INVALID_INPUT', 'Choose whether to share profile metadata');
  return {
    username,
    favoriteCuisine: optionalText(b.favoriteCuisine, 'favorite cuisine', 60),
    favoriteActivity: optionalText(b.favoriteActivity, 'favorite activity', 60),
    shareMetadata: b.shareMetadata,
  };
}
