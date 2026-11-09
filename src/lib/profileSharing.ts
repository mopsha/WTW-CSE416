import { Platform, Share } from 'react-native';
export function profileTarget(value: unknown): string | null {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value.toLowerCase()
    : null;
}
export function profileShareContent(id: string, name: string | null, username: string | null) {
  const target = profileTarget(id);
  if (!target) throw new Error('Profile sharing is unavailable for this account.');
  const url = `wtw://p/${target}`;
  const label = username ? `${name || username} (@${username})` : name || 'WTW member';
  const message = `${label} on WTW`;
  return Platform.OS === 'ios' ? { message, url } : { message: `${message}\n${url}` };
}
export async function shareProfile(id: string, name: string | null, username: string | null) {
  await Share.share(profileShareContent(id, name, username));
}
