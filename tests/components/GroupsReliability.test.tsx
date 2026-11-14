import React from 'react';
import { AppState, TextInput } from 'react-native';
import GroupsScreen from '../../app/groups/index';
import { api } from '@/lib/api';
import { queries } from '@/lib/queries';
import { useSession } from '@/hooks/useAuth';
import { router } from 'expo-router';
import { haptic } from '@/lib/haptics';
const { create, act } = jest.requireActual('react-test-renderer');
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useFocusEffect: (effect: () => void) => jest.requireActual('react').useEffect(effect, [effect]),
}));
jest.mock('@/hooks/useAuth', () => ({ useSession: jest.fn() }));
jest.mock('@/lib/api', () => ({ api: { createGroup: jest.fn() } }));
jest.mock('@/lib/queries', () => ({ queries: { listMyGroups: jest.fn() } }));
jest.mock('@/lib/haptics', () => ({ haptic: { tap: jest.fn(), success: jest.fn() } }));
jest.mock('@/components', () => ({
  ...jest.requireActual('@/components/theme'),
  Button: jest.requireActual('@/components/Button').Button,
  Card: jest.requireActual('@/components/Card').Card,
  Screen: (p: object) => jest.requireActual('react').createElement('test-screen', p),
  ErrorState: (p: object) => jest.requireActual('react').createElement('test-error', p),
  EmptyState: (p: object) => jest.requireActual('react').createElement('test-empty', p),
}));
const group = { id: 'crew', name: 'Our crew', memberCount: 3, ownerId: 'me', isOwner: true };
let tree: any;
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function target(label: string) {
  return tree.root.findAll(
    (n: any) =>
      n.props.accessibilityRole === 'button' &&
      n.props.accessibilityLabel === label &&
      typeof n.props.onPress === 'function',
  )[0];
}
async function mount() {
  await act(async () => {
    tree = create(<GroupsScreen />);
  });
}
async function refresh() {
  await act(async () => {
    await tree.root.findByType('test-screen').props.onRefresh();
  });
}
beforeEach(() => {
  jest.clearAllMocks();
  AppState.currentState = 'active';
  jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }));
  jest.mocked(useSession).mockReturnValue({ user: { id: 'me' } } as ReturnType<typeof useSession>);
  jest.mocked(queries.listMyGroups).mockResolvedValue([group]);
  jest.mocked(api.createGroup).mockResolvedValue(group as any);
});
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
  tree = null;
  jest.restoreAllMocks();
});
test('button plus keyboard submission creates once; failure preserves input and permits retry', async () => {
  await mount();
  await act(async () => tree.root.findByType(TextInput).props.onChangeText('New crew'));
  let reject!: (e: Error) => void;
  jest.mocked(api.createGroup).mockReturnValueOnce(
    new Promise((_yes, no) => {
      reject = no;
    }),
  );
  await act(async () => {
    target('Create group').props.onPress();
    tree.root.findByType(TextInput).props.onSubmitEditing();
  });
  expect(api.createGroup).toHaveBeenCalledTimes(1);
  await act(async () => reject(new Error('Offline')));
  expect(tree.root.findByType(TextInput).props.value).toBe('New crew');
  expect(router.push).not.toHaveBeenCalled();
  await act(async () => tree.root.findByType(TextInput).props.onSubmitEditing());
  expect(api.createGroup).toHaveBeenCalledTimes(2);
  expect(router.push).toHaveBeenCalledTimes(1);
  expect(tree.root.findByType(TextInput).props.value).toBe('');
});
test('group identity and Start are sibling targets with one navigation and haptic each', async () => {
  await mount();
  const open = target('Our crew, 3 people, you own it');
  const start = target('Start a Pick with Our crew');
  expect(start.findAll((n: any) => n === open)).toHaveLength(0);
  expect(open.findAll((n: any) => n === start)).toHaveLength(0);
  await act(async () => start.props.onPress());
  expect(router.push).toHaveBeenCalledTimes(1);
  expect(router.push).toHaveBeenLastCalledWith(expect.objectContaining({ pathname: '/pick/new' }));
  expect(haptic.tap).toHaveBeenCalledTimes(1);
  await act(async () => open.props.onPress());
  expect(router.push).toHaveBeenCalledTimes(2);
  expect(haptic.tap).toHaveBeenCalledTimes(2);
  expect(router.push).toHaveBeenLastCalledWith({
    pathname: '/groups/[id]',
    params: { id: 'crew' },
  });
});
test('transient failures retain rows; authorization failures clear them; retry recovers', async () => {
  await mount();
  jest.mocked(queries.listMyGroups).mockRejectedValueOnce(new Error('Offline'));
  await refresh();
  expect(target('Our crew, 3 people, you own it')).toBeDefined();
  jest
    .mocked(queries.listMyGroups)
    .mockRejectedValueOnce(Object.assign(new Error('Denied'), { code: '42501' }));
  await refresh();
  expect(target('Our crew, 3 people, you own it')).toBeUndefined();
  await refresh();
  expect(target('Our crew, 3 people, you own it')).toBeDefined();
});
test('older loads cannot replace newer rows, including across account switch and logout', async () => {
  const old = deferred<any>();
  jest.mocked(queries.listMyGroups).mockReturnValueOnce(old.promise);
  await mount();
  await refresh();
  await act(async () => old.resolve([{ ...group, name: 'Stale' }]));
  expect(JSON.stringify(tree.toJSON())).not.toContain('Stale');
  const pending = deferred<any>();
  jest.mocked(queries.listMyGroups).mockReturnValueOnce(pending.promise);
  await act(async () => {
    void tree.root.findByType('test-screen').props.onRefresh();
  });
  jest
    .mocked(useSession)
    .mockReturnValue({ user: { id: 'other' } } as ReturnType<typeof useSession>);
  jest.mocked(queries.listMyGroups).mockResolvedValue([]);
  await act(async () => tree.update(<GroupsScreen />));
  await act(async () => pending.resolve([group]));
  expect(JSON.stringify(tree.toJSON())).not.toContain('Our crew');
  const late = deferred<any>();
  jest.mocked(queries.listMyGroups).mockReturnValueOnce(late.promise);
  await act(async () => {
    void tree.root.findByType('test-screen').props.onRefresh();
  });
  await act(async () => tree.unmount());
  tree = null;
  await act(async () => late.resolve([group]));
});
test('creation completing after account switch cannot navigate for the old account', async () => {
  await mount();
  await act(async () => tree.root.findByType(TextInput).props.onChangeText('New crew'));
  const pending = deferred<any>();
  jest.mocked(api.createGroup).mockReturnValueOnce(pending.promise);
  await act(async () => target('Create group').props.onPress());
  jest
    .mocked(useSession)
    .mockReturnValue({ user: { id: 'other' } } as ReturnType<typeof useSession>);
  await act(async () => tree.update(<GroupsScreen />));
  await act(async () => pending.resolve(group));
  expect(router.push).not.toHaveBeenCalled();
});

test('background clears private rows and invalidates pending reads; foreground revalidates', async () => {
  const listeners: ((state: any) => void)[] = [];
  const subscription = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_event, listener) => {
      listeners.push(listener);
      return { remove: jest.fn() };
    });
  try {
    await mount();
    const pending = deferred<any>();
    jest.mocked(queries.listMyGroups).mockReturnValueOnce(pending.promise);
    await act(async () => {
      void tree.root.findByType('test-screen').props.onRefresh();
    });
    await act(async () => listeners.forEach((listener) => listener('background')));
    expect(target('Our crew, 3 people, you own it')).toBeUndefined();
    await act(async () => pending.resolve([group]));
    expect(target('Our crew, 3 people, you own it')).toBeUndefined();
    await act(async () => listeners.forEach((listener) => listener('active')));
    expect(target('Our crew, 3 people, you own it')).toBeDefined();
  } finally {
    subscription.mockRestore();
  }
});

test('invalid names never create a group', async () => {
  await mount();
  await act(async () => tree.root.findByType(TextInput).props.onSubmitEditing());
  expect(api.createGroup).not.toHaveBeenCalled();
  expect(router.push).not.toHaveBeenCalled();
});
