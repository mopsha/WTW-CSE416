import { Platform, Share } from 'react-native';
import { profileShareContent, profileTarget, shareProfile } from '@/lib/profileSharing';
const id = 'a0360001-3333-4333-8333-333333333333';
const os = Platform.OS;
afterEach(() => {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
  jest.restoreAllMocks();
});
test('iOS native sharing uses separate ID-backed URL and public name/username text', async () => {
  Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
  const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.dismissedAction });
  await shareProfile(id, 'Ava', 'ava_one');
  expect(share).toHaveBeenCalledWith({ message: 'Ava (@ava_one) on WTW', url: `wtw://p/${id}` });
  expect(profileShareContent(id, 'Ava', 'ava_two')).toMatchObject({ url: `wtw://p/${id}` });
});
test('Android includes the actual link in shared text; no invented HTTPS site', () => {
  Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
  expect(profileShareContent(id, null, 'ava')).toEqual({
    message: `ava (@ava) on WTW\nwtw://p/${id}`,
  });
  expect(profileTarget(id.toUpperCase())).toBe(id);
  for (const bad of ['../me', 'someone@example.com', 'not-a-uuid', null])
    expect(profileTarget(bad)).toBeNull();
});
test('share errors remain available for visible UI feedback', async () => {
  jest.spyOn(Share, 'share').mockRejectedValue(new Error('Native sharing unavailable'));
  await expect(shareProfile(id, 'Ava', 'ava')).rejects.toThrow('Native sharing unavailable');
});
