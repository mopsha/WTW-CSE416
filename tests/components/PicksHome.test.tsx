import React from 'react';
import { router, useFocusEffect } from 'expo-router';
import PicksScreen from '../../app/(tabs)/index';
import { queries } from '@/lib/queries';
import type { GroupSummary } from '@/lib/groups';
import type { PickSummary } from '@/lib/types';
import { PicksHero } from '@/components/picks/PicksHome';
import { Text } from 'react-native';
import { haptic } from '@/lib/haptics';

const { create, act } = jest.requireActual('react-test-renderer');
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() }, useFocusEffect: jest.fn() }));
jest.mock('@/hooks/useAuth', () => ({ useSession: () => ({ user: { id: 'me' } }) }));
jest.mock('@/lib/config', () => ({ USE_MOCK: false }));
jest.mock('@/lib/queries', () => ({
  queries: { listMyPicks: jest.fn(), listMyGroups: jest.fn() },
}));
jest.mock('@/lib/haptics', () => ({ haptic: { tap: jest.fn(), success: jest.fn() } }));
jest.mock('@/lib/mock/groups', () => ({ resetMockGroups: jest.fn() }));
jest.mock('@/lib/mock/store', () => ({ MOCK_INVITE_CODE: 'ABC123', resetMockData: jest.fn() }));
jest.mock('@/components/NotificationBell', () => ({ NotificationBell: () => null }));
jest.mock('@/components/JoinCodeCard', () => ({ JoinCodeCard: () => null }));
jest.mock('@/components/HangCard', () => ({ HangCard: () => null }));
jest.mock('@/components/ErrorBanner', () => ({
  ErrorBanner: (props: object) => jest.requireActual('react').createElement('test-error', props),
}));
jest.mock('@/components', () => {
  const React = jest.requireActual('react');
  return {
    ...Object.fromEntries(
      ['Screen', 'Button', 'Card'].map((name) => [
        name,
        (props: object) => React.createElement(`test-${name}`, props),
      ]),
    ),
  };
});
const group: GroupSummary = {
  id: 'group',
  name: 'CSE 416 Team',
  ownerId: 'me',
  isOwner: true,
  memberCount: 3,
};
const pick = (id: string, state: PickSummary['state']): PickSummary => ({
  id,
  state,
  category: 'food',
  deadlineAt: null,
});
beforeEach(() => {
  jest.resetAllMocks();
  jest
    .mocked(queries.listMyPicks)
    .mockResolvedValue([pick('live', 'final_vote'), pick('past', 'completed')]);
  jest.mocked(queries.listMyGroups).mockResolvedValue([group]);
});
async function mount() {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(<PicksScreen />);
  });
  return tree;
}
async function focus() {
  await act(async () => {
    jest.mocked(useFocusEffect).mock.calls.at(-1)![0]();
  });
}
const button = (tree: ReturnType<typeof create>, label: string) =>
  tree.root
    .findAllByType('test-Button')
    .find((n: { props: { label: string } }) => n.props.label === label)!;
test('active panel uses actual state and precedes groups; create, group and Pick routes stay intact', async () => {
  const tree = await mount();
  expect(
    tree.root.findAllByProps({ accessibilityLabel: 'Loading your Picks' }).length,
  ).toBeGreaterThan(0);
  await focus();
  const panel = tree.root.findByType('test-Card');
  expect(panel.props.accessibilityLabel).toBe('Food Pick, Final vote');
  await act(async () => panel.props.onPress());
  // The tappable Card supplies the haptic; this callback only navigates.
  expect(haptic.tap).not.toHaveBeenCalled();
  expect(router.push).toHaveBeenLastCalledWith({ pathname: '/pick/[id]', params: { id: 'live' } });
  await act(async () => button(tree, 'Start a Pick').props.onPress());
  expect(router.push).toHaveBeenLastCalledWith('/pick/new');
  const open = tree.root
    .findAllByProps({ accessibilityLabel: 'CSE 416 Team, 3 people' })
    .find((n: { props: { onPress?: unknown } }) => typeof n.props.onPress === 'function');
  await act(async () => open.props.onPress());
  expect(router.push).toHaveBeenLastCalledWith({
    pathname: '/groups/[id]',
    params: { id: 'group' },
  });
  await act(async () => button(tree, 'Start').props.onPress());
  expect(router.push).toHaveBeenLastCalledWith(expect.objectContaining({ pathname: '/pick/new' }));
  const json = JSON.stringify(tree.toJSON());
  expect(json.indexOf('Active Picks')).toBeLessThan(json.indexOf('Your groups'));
  expect(json).toContain('Decided');
  await act(async () => tree.unmount());
});
test('hero word fits a bounded line while retaining accessibility scaling and the full identity label', async () => {
  let tree: ReturnType<typeof create>;
  await act(async () => {
    tree = create(<PicksHero />);
  });
  const word = tree!.root
    .findAllByType(Text)
    .find((node: { props: { children: unknown } }) => node.props.children === 'word?');
  expect(word.props.numberOfLines).toBe(1);
  expect(word.props.adjustsFontSizeToFit).toBe(true);
  expect(word.props.allowFontScaling).not.toBe(false);
  expect(word.props.maxFontSizeMultiplier).toBeGreaterThan(1);
  const lead = tree!.root
    .findAllByType(Text)
    .find((node: { props: { children: unknown } }) => node.props.children === 'What’s the');
  expect(lead.props.maxFontSizeMultiplier).toBeUndefined();
  expect(
    tree!.root.findAllByProps({ accessibilityLabel: 'What’s the word?' }).length,
  ).toBeGreaterThan(0);
  await act(async () => tree!.unmount());
});
test('join sheet, empty state and retry remain available', async () => {
  jest
    .mocked(queries.listMyPicks)
    .mockRejectedValueOnce(new Error('Offline'))
    .mockResolvedValue([]);
  jest
    .mocked(queries.listMyGroups)
    .mockRejectedValueOnce(new Error('Groups offline'))
    .mockResolvedValue([]);
  const tree = await mount();
  await focus();
  expect(
    tree.root
      .findAllByType('test-error')
      .map((n: { props: { message: string } }) => n.props.message),
  ).toEqual(['Offline', 'Groups offline']);
  await act(async () => tree.root.findAllByType('test-error')[0].props.onRetry());
  expect(JSON.stringify(tree.toJSON())).toContain('No active picks');
  expect(JSON.stringify(tree.toJSON())).toContain('Make a group for your regular crew.');
  const join = tree.root
    .findAllByProps({ accessibilityLabel: 'Join with code' })
    .find((n: { props: { onPress?: unknown } }) => typeof n.props.onPress === 'function');
  await act(async () => join.props.onPress());
  // Existing Sheet mounts its Modal only when the join action opens it.
  expect(JSON.stringify(tree.toJSON())).toContain('Join with code');
  await act(async () => tree.unmount());
});
