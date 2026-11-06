import React from 'react';
import { TextInput } from 'react-native';
import {
  UsernameFriendSearch,
  PersonFriendAction,
} from '@/components/friends/UsernameFriendSearch';
import { ProfileActions } from '@/components/profile/ProfileActions';
import { api } from '@/lib/api';
import { shareProfile } from '@/lib/profileSharing';
import { router } from 'expo-router';
const { create, act } = jest.requireActual('react-test-renderer');
jest.mock('@/hooks/useAuth', () => ({ useSession: () => ({ user: { id: 'viewer' } }) }));
jest.mock('@/lib/api', () => ({
  api: { searchPeople: jest.fn(), addFriendByUsername: jest.fn() },
}));
jest.mock('@/lib/profileSharing', () => ({ shareProfile: jest.fn() }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/components/index', () => ({
  Button: (p: object) => jest.requireActual('react').createElement('test-button', p),
  ErrorState: (p: object) => jest.requireActual('react').createElement('test-error', p),
}));
jest.mock('@/components/friends/SocialRow', () => ({
  SocialIdentity: (p: object) => jest.requireActual('react').createElement('test-identity', p),
  SocialRow: ({ leading, actions, ...p }: any) =>
    jest.requireActual('react').createElement('test-row', p, leading, actions),
}));
const person = {
  userId: 'target',
  username: 'ava',
  displayName: 'Ava',
  relationship: 'none' as const,
};
let tree: any;
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  jest.mocked(api.searchPeople).mockResolvedValue({ people: [person] });
  jest.mocked(api.addFriendByUsername).mockResolvedValue({ status: 'sent' } as never);
});
afterEach(async () => {
  await act(async () => tree?.unmount());
  jest.useRealTimers();
});
async function mount() {
  await act(async () => {
    tree = create(<UsernameFriendSearch onAdded={() => {}} />);
  });
}
async function type(text: string) {
  await act(async () => tree.root.findByType(TextInput).props.onChangeText(text));
}
test('debounces normalized @username queries and renders existing identity components', async () => {
  await mount();
  await type('@AV');
  await act(async () => jest.advanceTimersByTime(400));
  expect(api.searchPeople).not.toHaveBeenCalled();
  await type('@AVA');
  await act(async () => jest.advanceTimersByTime(349));
  expect(api.searchPeople).not.toHaveBeenCalled();
  await act(async () => jest.advanceTimersByTime(1));
  expect(api.searchPeople).toHaveBeenCalledWith('ava');
  expect(tree.root.findByType('test-identity').props.userId).toBe('target');
  expect(tree.root.findByType('test-row').props.subtitle).toBe('@ava');
});
test('stale requests cannot replace a newer query; empty and failed results are explicit', async () => {
  let finish!: (v: any) => void;
  jest
    .mocked(api.searchPeople)
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          finish = r;
        }),
    )
    .mockResolvedValueOnce({ people: [] });
  await mount();
  await type('ava');
  await act(async () => jest.advanceTimersByTime(350));
  await type('ben');
  await act(async () => jest.advanceTimersByTime(350));
  await act(async () => finish({ people: [person] }));
  expect(tree.root.findAllByType('test-row')).toHaveLength(0);
  expect(JSON.stringify(tree.toJSON())).toContain('No matching usernames.');
  jest.mocked(api.searchPeople).mockRejectedValueOnce(new Error('Too many profile searches'));
  await type('cam');
  await act(async () => jest.advanceTimersByTime(350));
  expect(tree.root.findByType('test-error').props.message).toBe('Too many profile searches');
});
test.each([
  ['none', 'Add friend', false],
  ['requested', 'Requested', true],
  ['incoming', 'Respond', false],
  ['friends', 'Friends', true],
] as const)('relationship %s has correct action', async (relationship, label, disabled) => {
  await act(async () => {
    tree = create(
      <PersonFriendAction person={{ ...person, relationship }} onChanged={async () => {}} />,
    );
  });
  expect(tree.root.findByType('test-button').props).toMatchObject({ label, disabled });
  if (relationship === 'incoming') {
    await act(async () => tree.root.findByType('test-button').props.onPress());
    expect(router.push).toHaveBeenCalledWith({ pathname: '/friends', params: { requests: '1' } });
  }
});
test('request guard stays active through reconciliation and durable labels follow server data', async () => {
  let reconcile!: () => void;
  const refresh = jest.fn(
    () =>
      new Promise<void>((resolve) => {
        reconcile = resolve;
      }),
  );
  await act(async () => {
    tree = create(<PersonFriendAction person={person} onChanged={refresh} />);
  });
  await act(async () => {
    const p = tree.root.findByType('test-button').props.onPress;
    p();
    p();
  });
  expect(api.addFriendByUsername).toHaveBeenCalledTimes(1);
  expect(tree.root.findByType('test-button').props.loading).toBe(true);
  await act(async () => {
    tree.update(
      <PersonFriendAction person={{ ...person, relationship: 'requested' }} onChanged={refresh} />,
    );
    reconcile();
  });
  expect(tree.root.findByType('test-button').props).toMatchObject({
    label: 'Requested',
    disabled: true,
    loading: false,
  });
  await act(async () =>
    tree.update(
      <PersonFriendAction person={{ ...person, relationship: 'none' }} onChanged={refresh} />,
    ),
  );
  expect(tree.root.findByType('test-button').props).toMatchObject({
    label: 'Add friend',
    disabled: false,
  });
});
test('neutral acknowledgement does not invent a Requested relationship', async () => {
  await act(async () => {
    tree = create(<PersonFriendAction person={person} onChanged={async () => {}} />);
  });
  await act(async () => tree.root.findByType('test-button').props.onPress());
  expect(tree.root.findByType('test-button').props).toMatchObject({
    label: 'Add friend',
    disabled: false,
    loading: false,
  });
});
test('neutral acknowledgement with failed reconciliation does not invent a successful request', async () => {
  await act(async () => {
    tree = create(
      <PersonFriendAction
        person={person}
        onChanged={async () => {
          throw new Error('Refresh failed');
        }}
      />,
    );
  });
  await act(async () => tree.root.findByType('test-button').props.onPress());
  expect(tree.root.findByType('test-button').props.loading).toBe(false);
  expect(JSON.stringify(tree.toJSON())).not.toContain('Refresh failed');
  expect(tree.root.findByType('test-button').props.label).toBe('Add friend');
});

test('equal-width native share/edit controls preserve edit action and prevent repeated share taps', async () => {
  let done!: () => void;
  jest.mocked(shareProfile).mockImplementation(
    () =>
      new Promise((r) => {
        done = r;
      }),
  );
  const edit = jest.fn();
  await act(async () => {
    tree = create(<ProfileActions userId="target" name="Ava" username="ava" onEdit={edit} />);
  });
  const button = (label: string) =>
    tree.root.findAllByProps({ accessibilityLabel: label }).find((n: any) => n.props.onPress);
  const a = button('Edit profile for Ava');
  const b = button('Share profile');
  expect(a.props.style({ pressed: false })[0].flex).toBe(1);
  expect(b.props.style({ pressed: false })[0].flex).toBe(1);
  await act(async () => a.props.onPress());
  expect(edit).toHaveBeenCalledTimes(1);
  await act(async () => {
    b.props.onPress();
    b.props.onPress();
  });
  expect(shareProfile).toHaveBeenCalledTimes(1);
  expect(shareProfile).toHaveBeenCalledWith('target', 'Ava', 'ava');
  await act(async () => done());
});

test('native share failures have visible feedback', async () => {
  jest.mocked(shareProfile).mockRejectedValueOnce(new Error('Sharing unavailable'));
  await act(async () => {
    tree = create(<ProfileActions userId="target" name="Ava" username="ava" onEdit={() => {}} />);
  });
  const button = tree.root
    .findAllByProps({ accessibilityLabel: 'Share profile' })
    .find((n: any) => n.props.onPress);
  await act(async () => button.props.onPress());
  expect(JSON.stringify(tree.toJSON())).toContain('Sharing unavailable');
});

test('confirmed success survives a quota-limited refresh and later authoritative decline', async () => {
  jest
    .mocked(api.addFriendByUsername)
    .mockResolvedValue({ status: 'sent', relationship: 'requested' });
  const refresh = jest.fn().mockRejectedValue(new Error('429 Discovery limit reached'));
  await act(async () => {
    tree = create(<PersonFriendAction person={person} onChanged={refresh} />);
  });
  await act(async () => tree.root.findByType('test-button').props.onPress());
  expect(tree.root.findByType('test-button').props).toMatchObject({
    label: 'Requested',
    disabled: true,
  });
  await act(async () => tree.root.findByType('test-button').props.onPress());
  expect(api.addFriendByUsername).toHaveBeenCalledTimes(1);
  await act(async () =>
    tree.update(<PersonFriendAction person={{ ...person }} onChanged={refresh} />),
  );
  expect(tree.root.findByType('test-button').props.label).toBe('Add friend');
});

test('a projection received during submission cannot erase the later confirmed receipt', async () => {
  let finish!: (value: { status: 'sent'; relationship: 'requested' }) => void;
  jest.mocked(api.addFriendByUsername).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const refresh = jest.fn().mockRejectedValue(new Error('429'));
  await act(async () => {
    tree = create(<PersonFriendAction person={person} onChanged={refresh} />);
  });
  await act(async () => tree.root.findByType('test-button').props.onPress());
  await act(async () =>
    tree.update(<PersonFriendAction person={{ ...person }} onChanged={refresh} />),
  );
  await act(async () => finish({ status: 'sent', relationship: 'requested' }));
  expect(tree.root.findByType('test-button').props).toMatchObject({
    label: 'Requested',
    disabled: true,
  });
});
