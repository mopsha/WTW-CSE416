import React from 'react';
import { Text } from 'react-native';
import { AvailabilityLobby } from '@/components/AvailabilityLobby';
import { Button, Chips } from '@/components';
import { api } from '@/lib/api';
import { router } from 'expo-router';
import type { Availability } from '@shared/domain/availability.ts';
const { create, act } = jest.requireActual('react-test-renderer');
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), canGoBack: () => true, back: jest.fn() },
}));
jest.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ session: { user: { id: 'viewer' } } }) }));
jest.mock('@/lib/haptics', () => ({
  haptic: { tap: jest.fn(), tick: jest.fn(), error: jest.fn() },
}));
jest.mock('@/lib/api', () => ({
  api: { respondAvailability: jest.fn(), closePick: jest.fn(), closeVote: jest.fn() },
}));
const base = (): Availability => ({
  proposedAt: '2026-12-01T19:00:00Z',
  revision: 1,
  locked: false,
  responseOpen: true,
  canVote: false,
  cohortUserIds: [],
  eligibleUserIds: ['host'],
  deadlineMinutes: 60,
  participants: [
    { userId: 'viewer', displayName: 'You', response: null },
    { userId: 'host', displayName: 'Host', response: 'yes' },
  ],
});
let tree: ReturnType<typeof create>;
let value: Availability;
let state: 'swiping' | 'completed' = 'swiping';
const refresh = jest.fn();
const render = async () =>
  act(async () => {
    tree = create(
      <AvailabilityLobby
        pickId="pick"
        value={value}
        isHost={false}
        state={state}
        onCancel={jest.fn()}
        refresh={refresh}
        pending={false}
      />,
    );
  });
const button = (label: string) =>
  tree.root
    .findAllByType(Button)
    .find((n: { props: { label: string } }) => n.props.label === label);
const update = () =>
  tree.update(
    <AvailabilityLobby
      pickId="pick"
      value={value}
      isHost={false}
      state={state}
      onCancel={jest.fn()}
      refresh={refresh}
      pending={false}
    />,
  );
beforeEach(() => {
  jest.clearAllMocks();
  value = base();
  state = 'swiping';
  jest.mocked(api.respondAvailability).mockResolvedValue({ status: 'ok' });
  refresh.mockImplementation(async () => {});
});
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
});
test('invitation requires a local choice and truthful proposed-time explanation', async () => {
  await render();
  expect(button('Choose your response').props.disabled).toBe(true);
  expect(
    tree.root
      .findAllByType(Text)
      .some(
        (n: { props: { children: unknown } }) =>
          Array.isArray(n.props.children) && n.props.children.includes(' · Proposed time'),
      ),
  ).toBe(true);
  expect(
    tree.root
      .findAllByType(Text)
      .some(
        (n: { props: { children: unknown } }) =>
          n.props.children === 'Time not ideal? The group can revisit the time after deciding.',
      ),
  ).toBe(true);
  await act(async () => tree.root.findByType(Chips).props.onChange('maybe'));
  expect(button('Start swiping').props.disabled).toBe(false);
  expect(api.respondAvailability).not.toHaveBeenCalled();
});
test.each(['yes', 'maybe'] as const)(
  '%s response navigates directly after server confirmation, not selection',
  async (response) => {
    let finish!: (v: { status: 'ok' }) => void;
    jest.mocked(api.respondAvailability).mockReturnValueOnce(
      new Promise((r) => {
        finish = r;
      }),
    );
    await render();
    await act(async () => tree.root.findByType(Chips).props.onChange(response));
    await act(async () => button('Start swiping').props.onPress());
    expect(router.replace).not.toHaveBeenCalled();
    expect(tree.root.findByType(Chips).props.disabled).toBe(true);
    refresh.mockImplementation(async () => {
      value = {
        ...value,
        canVote: true,
        eligibleUserIds: ['host', 'viewer'],
        participants: value.participants.map((p) =>
          p.userId === 'viewer' ? { ...p, response } : p,
        ),
      };
      update();
    });
    await act(async () => finish({ status: 'ok' }));
    expect(api.respondAvailability).toHaveBeenCalledWith('pick', 1, response, 'viewer');
    expect(router.replace).toHaveBeenCalledWith({
      pathname: '/pick/[id]/swipe',
      params: { id: 'pick' },
    });
  },
);
test('Cant persists then follows read-only without granting voting access', async () => {
  await render();
  await act(async () => tree.root.findByType(Chips).props.onChange('cant'));
  refresh.mockImplementation(async () => {
    value = {
      ...value,
      participants: value.participants.map((p) =>
        p.userId === 'viewer' ? { ...p, response: 'cant' } : p,
      ),
    };
    update();
  });
  await act(async () => button('View Pick').props.onPress());
  expect(router.replace).not.toHaveBeenCalled();
  expect(button('Change availability')).toBeDefined();
});
test('recoverable errors preserve selection and allow retry', async () => {
  jest.mocked(api.respondAvailability).mockRejectedValueOnce(new Error('Offline'));
  await render();
  await act(async () => tree.root.findByType(Chips).props.onChange('maybe'));
  await act(async () => button('Start swiping').props.onPress());
  expect(tree.root.findByType(Chips).props.value).toBe('maybe');
  expect(
    tree.root
      .findAllByType(Text)
      .some((n: { props: { children: unknown } }) => n.props.children === 'Offline'),
  ).toBe(true);
  expect(router.replace).not.toHaveBeenCalled();
});
test('late completion from an unmounted account/revision does not navigate', async () => {
  let finish!: (v: { status: 'ok' }) => void;
  jest.mocked(api.respondAvailability).mockReturnValueOnce(
    new Promise((r) => {
      finish = r;
    }),
  );
  await render();
  await act(async () => tree.root.findByType(Chips).props.onChange('yes'));
  await act(async () => button('Start swiping').props.onPress());
  await act(async () => tree.unmount());
  await act(async () => finish({ status: 'ok' }));
  expect(router.replace).not.toHaveBeenCalled();
  expect(refresh).not.toHaveBeenCalled();
});
test('first swipe removes the eligibility-changing decline but keeps Yes/Maybe', async () => {
  value.participants[0] = { userId: 'viewer', displayName: 'You', response: 'yes', started: true };
  value.canVote = true;
  await render();
  expect(tree.root.findByType(Chips).props.options.map((p: { value: string }) => p.value)).toEqual([
    'yes',
    'maybe',
  ]);
});

test('closure during a confirmed response reconciles to the winner instead of opening swiping', async () => {
  await render();
  await act(async () => tree.root.findByType(Chips).props.onChange('yes'));
  refresh.mockImplementation(async () => {
    state = 'completed';
    value = {
      ...value,
      locked: true,
      responseOpen: false,
      participants: value.participants.map((p) =>
        p.userId === 'viewer' ? { ...p, response: 'yes' } : p,
      ),
    };
    update();
  });
  await act(async () => button('Start swiping').props.onPress());
  expect(router.replace).toHaveBeenCalledWith({
    pathname: '/pick/[id]/winner',
    params: { id: 'pick' },
  });
});
