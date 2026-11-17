import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import React from 'react';

import { TasteNudge } from '@/components/TasteNudge';
import { useProfile } from '@/hooks/useProfile';

type Node = { props: Record<string, any> };
type Tree = {
  root: { findAll(test: (n: Node) => boolean): Node[] };
  toJSON(): unknown;
  unmount(): void;
};
const { create, act } = jest.requireActual<{
  create(element: React.ReactElement): Tree;
  act(work: () => void | Promise<void>): Promise<void>;
}>('react-test-renderer');

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/hooks/useProfile', () => ({ useProfile: jest.fn() }));
let mockUser = 'me';
jest.mock('@/hooks/useAuth', () => ({ useSession: () => ({ user: { id: mockUser } }) }));
jest.mock('@/lib/haptics', () => ({ haptic: { tap: jest.fn() } }));

let tree: Tree;
function profile(state: { loading?: boolean; failed?: boolean; onboarded?: boolean }) {
  jest.mocked(useProfile).mockReturnValue({
    loading: false,
    failed: false,
    onboarded: false,
    ...state,
  } as ReturnType<typeof useProfile>);
}
async function render() {
  await act(async () => {
    tree = create(<TasteNudge />);
  });
}
const byLabel = (label: string) =>
  tree.root.findAll((n) => n.props.accessibilityLabel === label && !!n.props.onPress)[0];

beforeEach(async () => {
  jest.clearAllMocks();
  mockUser = 'me';
  await AsyncStorage.clear();
});
afterEach(async () => {
  await act(async () => tree.unmount());
});

test('shows for someone who never saved preferences and opens the taste-only flow', async () => {
  profile({});
  await render();
  expect(tree.toJSON()).not.toBeNull();
  await act(async () => byLabel('Start swiping')!.props.onPress());
  expect(router.push).toHaveBeenCalledWith({ pathname: '/onboarding', params: { mode: 'taste' } });
});

test.each([{ onboarded: true }, { loading: true }, { failed: true }])(
  'stays hidden when %o',
  async (state) => {
    profile(state);
    await render();
    expect(tree.toJSON()).toBeNull();
  },
);

test('dismissing hides it now and on the next launch', async () => {
  profile({});
  await render();
  await act(async () => byLabel('Dismiss')!.props.onPress());
  expect(tree.toJSON()).toBeNull();
  await act(async () => tree.unmount());
  await render();
  expect(tree.toJSON()).toBeNull();
});

test('dismissal belongs to the account that dismissed it', async () => {
  profile({});
  await render();
  await act(async () => byLabel('Dismiss')!.props.onPress());
  await act(async () => tree.unmount());
  mockUser = 'someone-else';
  await render();
  expect(tree.toJSON()).not.toBeNull();
});
