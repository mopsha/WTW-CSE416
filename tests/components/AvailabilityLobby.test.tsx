import React from 'react';
import { Text } from 'react-native';
import { AvailabilityLobby } from '@/components/AvailabilityLobby';
import { Button, Chips } from '@/components';
import { api } from '@/lib/api';
import type { Availability } from '@shared/domain/availability.ts';
const { create, act } = jest.requireActual('react-test-renderer');
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-router', () => ({ router: { canGoBack: () => true, back: jest.fn() } }));
jest.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ session: { user: { id: 'viewer' } } }) }));
jest.mock('@/lib/haptics', () => ({
  haptic: { tap: jest.fn(), error: jest.fn(), success: jest.fn() },
}));
jest.mock('@/lib/api', () => ({
  api: { respondAvailability: jest.fn(), changeProposedTime: jest.fn() },
}));
jest.mock('@/components/PlanTimeSheet', () => ({ PlanTimeSheet: () => null }));
const base = (): Availability => ({
  proposedAt: '2026-12-01T19:00:00Z',
  revision: 3,
  locked: false,
  canVote: false,
  cohortUserIds: [],
  deadlineMinutes: 60,
  participants: [
    { userId: 'viewer', displayName: 'You', response: null },
    { userId: 'host', displayName: 'Host', response: 'yes' },
    { userId: 'maybe', displayName: 'Maybe person', response: 'maybe' },
    { userId: 'cant', displayName: 'Declining person', response: 'cant' },
  ],
});
let tree: ReturnType<typeof create>;
const refresh = jest.fn().mockResolvedValue(undefined);
const start = jest.fn();
const render = async (value = base(), isHost = false) =>
  act(async () => {
    tree = create(
      <AvailabilityLobby
        pickId="pick"
        value={value}
        isHost={isHost}
        state={value.locked ? 'swiping' : 'draft'}
        onStart={start}
        onCancel={jest.fn()}
        refresh={refresh}
        pending={false}
      />,
    );
  });
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(api.respondAvailability).mockResolvedValue({ status: 'ok' });
});
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
});
test('invitation shows explicit response state, counts, and no premature voting action', async () => {
  await render();
  const choices = tree.root.findByType(Chips);
  expect(choices.props.value).toBe('none');
  expect(choices.props.accessibilityLabel).toBe('Your availability');
  expect(
    tree.root
      .findAllByType(Button)
      .some((n: { props: { label: string } }) => n.props.label === 'Start Swiping'),
  ).toBe(false);
  expect(
    tree.root
      .findAllByType(Text)
      .map((n: { props: { children: unknown } }) => n.props.children)
      .flat(),
  ).toContain(' awaiting');
});
test('response is server-confirmed, scoped to account/revision and locked while pending', async () => {
  let finish!: (v: { status: 'ok' }) => void;
  jest.mocked(api.respondAvailability).mockReturnValueOnce(
    new Promise((r) => {
      finish = r;
    }),
  );
  await render();
  await act(async () => tree.root.findByType(Chips).props.onChange('maybe'));
  expect(api.respondAvailability).toHaveBeenCalledWith('pick', 3, 'maybe', 'viewer');
  expect(tree.root.findByType(Chips).props.value).toBe('none');
  expect(tree.root.findByType(Chips).props.disabled).toBe(true);
  expect(refresh).not.toHaveBeenCalled();
  await act(async () => finish({ status: 'ok' }));
  expect(refresh).toHaveBeenCalledTimes(1);
});
test('unmounted revision/account owner ignores late response completion', async () => {
  let finish!: (v: { status: 'ok' }) => void;
  jest.mocked(api.respondAvailability).mockReturnValueOnce(
    new Promise((r) => {
      finish = r;
    }),
  );
  await render();
  await act(async () => tree.root.findByType(Chips).props.onChange('yes'));
  await act(async () => tree.unmount());
  await act(async () => finish({ status: 'ok' }));
  expect(refresh).not.toHaveBeenCalled();
});
test('only host gets server-confirmed start; locked observers cannot change availability', async () => {
  await render(base(), true);
  const action = tree.root
    .findAllByType(Button)
    .find((n: { props: { label: string } }) => n.props.label === 'Start Swiping');
  expect(action.props.disabled).toBe(false);
  await act(async () => action.props.onPress());
  expect(start).toHaveBeenCalledTimes(1);
  await act(async () => tree.unmount());
  await render({ ...base(), locked: true });
  expect(tree.root.findAllByType(Chips)).toHaveLength(0);
});
