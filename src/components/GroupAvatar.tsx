import { SocialIdentity } from './friends/SocialRow';

/** Group initials always use the same social palette; groups never resolve a user photo. */
export function GroupAvatar({ name, size = 40 }: { name: string; size?: number }) {
  return <SocialIdentity name={name} size={size} group />;
}
