import React from 'react';
import { router, useFocusEffect } from 'expo-router';
import PicksScreen from '../../app/(tabs)/index';
import { queries } from '@/lib/queries';
import { api } from '@/lib/api';
import { GoogleCredit } from '@/components/GoogleCredit';
import { useSession } from '@/hooks/useAuth';
import type { GroupSummary } from '@/lib/groups';
import type { PickSummary } from '@/lib/types';
import { PicksHero } from '@/components/picks/PicksHome';
import { Text } from 'react-native';
import { haptic } from '@/lib/haptics';

const { create, act } = jest.requireActual('react-test-renderer');
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() }, useFocusEffect: jest.fn() }));
jest.mock('@/hooks/useAuth', () => ({ useSession: jest.fn() }));
jest.mock('@/lib/api', () => ({ api: { resolveRecentWinners: jest.fn() } }));
jest.mock('@/lib/config', () => ({ USE_MOCK: false }));
jest.mock('@/lib/queries', () => ({
  queries: { listPicksHome: jest.fn(), listMyGroups: jest.fn() },
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
  jest.mocked(useSession).mockReturnValue({ user: { id: 'me' } } as ReturnType<typeof useSession>);
  jest.mocked(api.resolveRecentWinners).mockResolvedValue([]);
  jest
    .mocked(queries.listPicksHome)
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
    .mocked(queries.listPicksHome)
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

test('Recent History renders five newest persisted winners and preserves See all and row routes', async () => {
  jest.mocked(queries.listPicksHome).mockResolvedValue([
    ...[2, 6, 1, 5, 4, 3].map((n) => ({
      ...pick(String(n), 'completed'),
      category: ['food', 'activities', 'both', 'custom'][n % 4]!,
      winnerName: `Winner ${n}`,
      decidedAt: `2026-11-0${n}T12:00:00Z`,
    })),
    pick('active', 'draft'),
  ]);
  const tree = await mount();
  await focus();
  const { ListRow } = jest.requireActual('@/components/TabUi');
  const rows = tree.root.findAllByType(ListRow);
  expect(rows.map((n: any) => n.props.title)).toEqual([
    'Winner 6',
    'Winner 5',
    'Winner 4',
    'Winner 3',
    'Winner 2',
  ]);
  expect(JSON.stringify(tree.toJSON())).toContain('Recent History');
  expect(JSON.stringify(tree.toJSON())).not.toContain('Winner 1');
  await act(async () => rows[0].props.onPress());
  expect(router.push).toHaveBeenLastCalledWith({ pathname: '/pick/[id]', params: { id: '6' } });
  await act(async () => button(tree, 'See all').props.onPress());
  expect(router.push).toHaveBeenLastCalledWith('/history');
  await act(async () => tree.unmount());
});
test('Recent History stays out of loading state and offers full History when empty', async () => {
  jest.mocked(queries.listPicksHome).mockResolvedValue([]);
  const tree = await mount();
  expect(JSON.stringify(tree.toJSON())).not.toContain('Recent History');
  await focus();
  expect(JSON.stringify(tree.toJSON())).toContain('Your finished Picks will appear here.');
  await act(async () => button(tree, 'See all').props.onPress());
  expect(router.push).toHaveBeenLastCalledWith('/history');
  await act(async () => tree.unmount());
});

test('long preview titles are visually limited while the full accessible name remains intact', async () => {
  const name = 'A very long custom celebration option '.repeat(5).trim();
  jest
    .mocked(queries.listPicksHome)
    .mockResolvedValue([{ ...pick('long', 'completed'), category: 'custom', winnerName: name }]);
  const tree = await mount();
  await focus();
  const { ListRow } = jest.requireActual('@/components/TabUi');
  const row = tree.root.findByType(ListRow);
  expect(row.props.titleNumberOfLines).toBe(2);
  const title = row.findAllByType(Text).find((n: any) => n.props.children === name);
  expect(title.props.numberOfLines).toBe(2);
  expect(
    row
      .findAllByProps({ accessibilityRole: 'button' })
      .some((n: any) => n.props.accessibilityLabel.startsWith(name + ',')),
  ).toBe(true);
  await act(async () => tree.unmount());
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const googlePick = (id = 'google') => ({
  ...pick(id, 'completed'),
  winnerName: null,
  winnerProvider: 'google',
  winnerPlaceId: 'persisted',
});
const liveWinner = (pickId = 'google', placeId = 'persisted') => ({
  pickId,
  place: {
    placeId,
    name: 'Live Google Cafe',
    provider: 'google' as const,
    photoUrl: null,
    priceLevel: null,
    rating: null,
    cuisine: null,
    address: null,
    lat: null,
    lng: null,
    googleMapsUri: 'https://maps.google.com/place',
    attributions: [{ provider: 'Data partner', uri: 'https://example.com/credit' }],
  },
});
test('null Google snapshot name resolves only the displayed persisted winner with GoogleCredit', async () => {
  const pending = deferred<Awaited<ReturnType<typeof api.resolveRecentWinners>>>();
  jest
    .mocked(queries.listPicksHome)
    .mockResolvedValue([
      googlePick(),
      { ...pick('custom', 'completed'), winnerName: 'Our custom option' },
      { ...pick('mock', 'completed'), winnerName: 'Stored mock name' },
      { ...googlePick('canceled'), state: 'canceled' },
      pick('missing', 'completed'),
    ]);
  jest.mocked(api.resolveRecentWinners).mockReturnValue(pending.promise);
  const tree = await mount();
  await focus();
  expect(api.resolveRecentWinners).toHaveBeenCalledTimes(1);
  expect(api.resolveRecentWinners).toHaveBeenCalledWith(['google']);
  expect(JSON.stringify(tree.toJSON())).toContain('Our custom option');
  expect(JSON.stringify(tree.toJSON())).toContain('Stored mock name');
  expect(tree.root.findAllByType(GoogleCredit)).toHaveLength(0);
  await act(async () => pending.resolve([liveWinner()]));
  expect(JSON.stringify(tree.toJSON())).toContain('Live Google Cafe');
  expect(tree.root.findByType(GoogleCredit).props.place.placeId).toBe('persisted');
  expect(JSON.stringify(tree.toJSON())).toContain('Google Maps');
  expect(JSON.stringify(tree.toJSON())).toContain('Data partner');
  await act(async () => tree.unmount());
});
test.each(['quota', 'unavailable', 'wrong winner'])(
  'Google %s keeps safe fallbacks without retries or attribution for absent content',
  async (failure) => {
    jest.mocked(queries.listPicksHome).mockResolvedValue([googlePick()]);
    if (failure === 'quota')
      jest.mocked(api.resolveRecentWinners).mockRejectedValue(new Error('Quota exceeded'));
    else
      jest
        .mocked(api.resolveRecentWinners)
        .mockResolvedValue(failure === 'wrong winner' ? [liveWinner('google', 'different')] : []);
    const tree = await mount();
    await focus();
    expect(JSON.stringify(tree.toJSON())).not.toContain('Live Google Cafe');
    expect(tree.root.findAllByType(GoogleCredit)).toHaveLength(0);
    expect(api.resolveRecentWinners).toHaveBeenCalledTimes(1);
    await act(async () => tree.unmount());
  },
);
test('resolves a maximum of five visible winners', async () => {
  jest
    .mocked(queries.listPicksHome)
    .mockResolvedValue(Array.from({ length: 8 }, (_, n) => googlePick(String(n))));
  const tree = await mount();
  await focus();
  expect(jest.mocked(api.resolveRecentWinners).mock.calls[0]![0]).toHaveLength(5);
  await act(async () => tree.unmount());
});
test('blur retains Picks/groups, refocus refreshes without a spinner, and duplicate refreshes coalesce', async () => {
  const tree = await mount();
  let cleanup!: () => void;
  await act(async () => {
    cleanup = jest.mocked(useFocusEffect).mock.calls.at(-1)![0]() as () => void;
  });
  await act(async () => cleanup());
  const pending = deferred<PickSummary[]>();
  jest.mocked(queries.listPicksHome).mockReturnValue(pending.promise);
  await focus();
  expect(tree.root.findAllByProps({ accessibilityLabel: 'Loading your Picks' })).toHaveLength(0);
  expect(JSON.stringify(tree.toJSON())).toContain('CSE 416 Team');
  expect(JSON.stringify(tree.toJSON())).toContain('Final vote');
  await act(async () => tree.root.findByType('test-Screen').props.onRefresh());
  expect(queries.listPicksHome).toHaveBeenCalledTimes(2);
  await act(async () => pending.resolve([pick('new', 'draft')]));
  expect(JSON.stringify(tree.toJSON())).not.toContain('Final vote');
  await act(async () => tree.unmount());
});
test('stale Pick and group responses cannot overwrite the next focus', async () => {
  const oldPicks = deferred<PickSummary[]>(),
    oldGroups = deferred<GroupSummary[]>();
  jest.mocked(queries.listPicksHome).mockReturnValueOnce(oldPicks.promise);
  jest.mocked(queries.listMyGroups).mockReturnValueOnce(oldGroups.promise);
  const tree = await mount();
  let cleanup!: () => void;
  await act(async () => {
    cleanup = jest.mocked(useFocusEffect).mock.calls.at(-1)![0]() as () => void;
  });
  await act(async () => cleanup());
  await focus();
  await act(async () => {
    oldPicks.resolve([{ ...pick('old', 'completed'), winnerName: 'STALE' }]);
    oldGroups.resolve([{ ...group, name: 'STALE GROUP' }]);
  });
  expect(JSON.stringify(tree.toJSON())).not.toContain('STALE');
  expect(JSON.stringify(tree.toJSON())).toContain('CSE 416 Team');
  await act(async () => tree.unmount());
});
test('account switches and logout discard cached data and late Google results', async () => {
  const pending = deferred<Awaited<ReturnType<typeof api.resolveRecentWinners>>>();
  jest.mocked(queries.listPicksHome).mockResolvedValue([googlePick()]);
  jest.mocked(api.resolveRecentWinners).mockReturnValue(pending.promise);
  const tree = await mount();
  await focus();
  jest
    .mocked(useSession)
    .mockReturnValue({ user: { id: 'other' } } as ReturnType<typeof useSession>);
  await act(async () => tree.update(<PicksScreen />));
  expect(JSON.stringify(tree.toJSON())).not.toContain('CSE 416 Team');
  expect(
    tree.root.findAllByProps({ accessibilityLabel: 'Loading your Picks' }).length,
  ).toBeGreaterThan(0);
  await act(async () => pending.resolve([liveWinner()]));
  expect(JSON.stringify(tree.toJSON())).not.toContain('Live Google Cafe');
  await act(async () => tree.unmount()); // Auth guard unmounts this screen on logout.
  jest.mocked(useSession).mockReturnValue({ user: { id: 'me' } } as ReturnType<typeof useSession>);
  const next = await mount();
  expect(JSON.stringify(next.toJSON())).not.toContain('CSE 416 Team');
  expect(JSON.stringify(next.toJSON())).not.toContain('Live Google Cafe');
  await act(async () => next.unmount());
});
