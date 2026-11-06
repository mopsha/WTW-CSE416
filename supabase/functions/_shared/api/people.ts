import type { AvatarRef } from './avatars.ts';
export interface PersonIdentity {
  userId: string;
  displayName: string | null;
  username: string;
  avatarRef?: AvatarRef | null;
  relationship: 'none' | 'requested' | 'incoming' | 'friends' | 'self';
}
