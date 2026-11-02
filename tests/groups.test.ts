import { createPickMaybeForGroup, type GroupsStore } from '@shared/api/groups.ts';
import type { LifecycleStore } from '@shared/api/lifecycle.ts';

const GROUP = '71111111-1111-4111-8111-111111111111';
const body = {
  category: 'food',
  center: { lat: 40.9, lng: -73.1 },
  radiusM: 5000,
  groupId: GROUP,
};

function stores(over: { add?: () => Promise<number>; load?: () => Promise<unknown> } = {}) {
  const lifecycle = {
    createPick: jest.fn(async () => ({ id: 'new-pick' })),
    load: jest.fn(over.load ?? (async () => ({ participantIds: ['me', 'ava', 'ben'] }))),
    cancel: jest.fn(async () => {}),
    notifier: jest.fn(async () => {}),
  };
  const groups = {
    isMember: jest.fn(async () => true),
    addGroupToPick: jest.fn(over.add ?? (async () => 2)),
  };
  return {
    lifecycle,
    groups,
    run: () =>
      createPickMaybeForGroup(
        lifecycle as unknown as LifecycleStore,
        groups as unknown as GroupsStore,
        'me',
        body,
      ),
  };
}

test('a group Pick tells everyone added, except the host', async () => {
  const { lifecycle, run } = stores();
  await expect(run()).resolves.toMatchObject({ pickId: 'new-pick', groupId: GROUP, added: 2 });
  expect(lifecycle.notifier).toHaveBeenCalledWith(['ava', 'ben'], 'added_to_pick', 'new-pick');
  expect(lifecycle.cancel).not.toHaveBeenCalled();
});

test('if adding the group fails, the empty draft is canceled and the error returned', async () => {
  const { lifecycle, run } = stores({ add: () => Promise.reject(new Error('group changed')) });
  await expect(run()).rejects.toThrow('group changed');
  expect(lifecycle.cancel).toHaveBeenCalledWith('new-pick', 'me', null);
});

test('a failed read after the add keeps the Pick and only skips the notice', async () => {
  const { lifecycle, run } = stores({ load: () => Promise.reject(new Error('read failed')) });
  await expect(run()).resolves.toMatchObject({ pickId: 'new-pick', added: 2 });
  expect(lifecycle.cancel).not.toHaveBeenCalled();
  expect(lifecycle.notifier).not.toHaveBeenCalled();
});
