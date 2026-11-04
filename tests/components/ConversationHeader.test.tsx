import React from 'react';
import { ConversationHeader } from '@/components/ConversationHeader';
import { SocialIdentity } from '@/components/friends/SocialRow';
import { router } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { space } from '@/components/theme';
const { create, act } = jest.requireActual('react-test-renderer');
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-router', () => ({
  router: { canGoBack: jest.fn(), back: jest.fn(), replace: jest.fn() },
}));
jest.mock('@/components', () => ({
  Avatar: (p: object) => jest.requireActual('react').createElement('test-avatar', p),
  IconButton: (p: object) => jest.requireActual('react').createElement('test-back', p),
}));
beforeEach(() => jest.clearAllMocks());
test('conversation back uses history and falls back to Picks on a cold start', async () => {
  let tree: any;
  await act(async () => {
    tree = create(
      <ConversationHeader name="Ava" uri="https://example.test/avatar.jpg" subtitle="@ava" />,
    );
  });
  expect(tree.root.findByType(SocialIdentity).props.uri).toBe('https://example.test/avatar.jpg');
  jest.mocked(router.canGoBack).mockReturnValue(true);
  await act(async () => tree.root.findByType('test-back').props.onPress());
  expect(router.back).toHaveBeenCalledTimes(1);
  jest.mocked(router.canGoBack).mockReturnValue(false);
  await act(async () => tree.root.findByType('test-back').props.onPress());
  expect(router.replace).toHaveBeenCalledWith('/');
  await act(async () => tree.unmount());
});
test('group identity retains access to the existing members section', async () => {
  const onPress = jest.fn();
  let tree: any;
  await act(async () => {
    tree = create(<ConversationHeader name="Our crew" onPress={onPress} />);
  });
  await act(async () =>
    tree.root
      .findAllByProps({ accessibilityLabel: 'Our crew' })
      .find((n: any) => typeof n.props.onPress === 'function')
      .props.onPress(),
  );
  expect(onPress).toHaveBeenCalledTimes(1);
  await act(async () => tree.unmount());
});
test('loading and unavailable headers contain no invented identity and retain back spacing', async () => {
  let tree: any;
  await act(async () => {
    tree = create(<ConversationHeader loading />);
  });
  expect(tree.root.findAllByType(SocialIdentity)).toHaveLength(0);
  expect(tree.root.findAllByType(ActivityIndicator)).toHaveLength(1);
  const header = tree.root
    .findAllByType(View)
    .find((node: any) => StyleSheet.flatten(node.props.style)?.minHeight === 60);
  expect(StyleSheet.flatten(header.props.style).paddingHorizontal).toBe(space.md);
  await act(async () => tree.update(<ConversationHeader />));
  expect(tree.root.findAllByType(SocialIdentity)).toHaveLength(0);
  expect(JSON.stringify(tree.toJSON())).toContain('Conversation unavailable');
  expect(JSON.stringify(tree.toJSON())).not.toContain('WTW friend');
  await act(async () => tree.unmount());
});
