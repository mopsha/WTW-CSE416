import { SocialIdentity } from '@/components/friends/SocialRow';
import React from 'react';
import { Image } from 'react-native';
import { Avatar } from '@/components/Avatar';
import { avatarCache, useAvatarLifecycle, useAvatarPhoto } from '@/hooks/useAvatarSource';
import { photoChanged } from '@/lib/photoEvents';
import { api } from '@/lib/api';
import type { AuthSession } from '@/lib/authTypes';
type Tree = {
  root: { findAllByType(t: unknown): { props: { source: { uri: string }; onError(): void } }[] };
  update(e: React.ReactElement): void;
  unmount(): void;
  toJSON(): unknown;
};
const { create, act } = jest.requireActual<{
  create(e: React.ReactElement): Tree;
  act(fn: () => void | Promise<void>): Promise<void>;
}>('react-test-renderer');
let mockSession: AuthSession | null = {
  user: { id: 'A', email: 'a@example.com' },
  accessToken: 'token',
};
jest.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ session: mockSession }) }));
jest.mock('expo-router', () => ({
  useFocusEffect: (fn: () => void) => jest.requireActual('react').useEffect(fn, [fn]),
}));
jest.mock('@/lib/api', () => ({ api: { getAvatar: jest.fn(), resolveAvatarRefs: jest.fn() } }));
const ref = { userId: 'friend', revision: 1 };
let tree: Tree | undefined;
function Harness({
  resolve = false,
  pathname = '/profile',
}: {
  resolve?: boolean;
  pathname?: string;
}) {
  useAvatarLifecycle(mockSession?.user.id, pathname, mockSession?.user.email);
  return <Avatar name="Ava" userId="friend" avatarRef={resolve ? undefined : ref} />;
}
beforeEach(() => {
  jest.clearAllMocks();
  tree = undefined;
  avatarCache.setViewer(null);
  avatarCache.setActive(true);
  mockSession = { user: { id: 'A', email: 'a@example.com' }, accessToken: 'token' };
  jest.mocked(api.getAvatar).mockResolvedValue('data:image/jpeg;base64,/9j/2Q==');
  jest.mocked(api.resolveAvatarRefs).mockResolvedValue({ friend: { revision: 1, avatarRef: ref } });
});
afterEach(async () => {
  await act(async () => tree?.unmount());
});
async function mount(resolve = false) {
  await act(async () => {
    tree = create(<Harness resolve={resolve} />);
  });
}
test('managed photos render memory sources; decode errors fall back to initials', async () => {
  await mount();
  const images = tree!.root.findAllByType(Image);
  expect(images[0]!.props.source.uri).toBe('data:image/jpeg;base64,/9j/2Q==');
  await act(async () => images[0]!.props.onError());
  expect(tree!.root.findAllByType(Image)).toHaveLength(0);
  expect(JSON.stringify(tree!.toJSON())).toContain('A');
});
test('denied downloads leave the initials fallback', async () => {
  jest.mocked(api.getAvatar).mockRejectedValue(new Error('404'));
  await mount();
  expect(api.getAvatar).toHaveBeenCalled();
  expect(tree!.root.findAllByType(Image)).toHaveLength(0);
});
test('removal clears pixels and replacement refreshes despite stale parent props', async () => {
  await mount();
  expect(tree!.root.findAllByType(Image)).toHaveLength(1);
  await act(async () => photoChanged('friend', { revision: 2, avatarRef: null }));
  expect(tree!.root.findAllByType(Image)).toHaveLength(0);
  jest.mocked(api.getAvatar).mockResolvedValueOnce('data:image/jpeg;base64,new');
  await act(async () =>
    photoChanged('friend', { revision: 3, avatarRef: { userId: 'friend', revision: 3 } }),
  );
  expect(tree!.root.findAllByType(Image)[0]!.props.source.uri).toBe('data:image/jpeg;base64,new');
});
test('sign-out prevents late private bytes from rendering', async () => {
  let finish!: (value: string) => void;
  jest.mocked(api.getAvatar).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await mount();
  expect(api.getAvatar).toHaveBeenCalled();
  mockSession = null;
  await act(async () => tree!.update(<Harness />));
  await act(async () => finish('data:image/jpeg;base64,old'));
  expect(tree!.root.findAllByType(Image)).toHaveLength(0);
});
test('switching mock accounts with the same fixture ID clears the previous source', async () => {
  await mount();
  expect(tree!.root.findAllByType(Image)).toHaveLength(1);
  jest.mocked(api.getAvatar).mockResolvedValue('data:image/jpeg;base64,second-account');
  mockSession = { user: { id: 'A', email: 'second@example.com' }, accessToken: 'token' };
  await act(async () => tree!.update(<Harness />));
  expect(tree!.root.findAllByType(Image)[0]!.props.source.uri).toBe(
    'data:image/jpeg;base64,second-account',
  );
});
test('person-only identities resolve in a batch and never download revision zero', async () => {
  await mount(true);
  expect(tree!.root.findAllByType(Image)).toHaveLength(1);
  expect(api.resolveAvatarRefs).toHaveBeenCalledWith('A', ['friend'], expect.anything());
  expect(api.getAvatar).toHaveBeenCalledWith('A', ref, expect.anything());
  expect(jest.mocked(api.getAvatar).mock.calls.every(([, photo]) => photo.revision > 0)).toBe(true);
});

test('pathname changes revalidate without flushing downloaded bytes', async () => {
  await mount();
  expect(api.getAvatar).toHaveBeenCalledTimes(1);
  await act(async () => tree!.update(<Harness pathname="/friends" />));
  expect(api.getAvatar).toHaveBeenCalledTimes(1);
  expect(tree!.root.findAllByType(Image)).toHaveLength(1);
});

test('foreground metadata polling uses the bounded thirty-second cadence', async () => {
  jest.useFakeTimers();
  try {
    await mount();
    const initial = jest.mocked(api.resolveAvatarRefs).mock.calls.length;
    await act(async () => jest.advanceTimersByTimeAsync(5_000));
    expect(api.resolveAvatarRefs).toHaveBeenCalledTimes(initial);
    await act(async () => jest.advanceTimersByTimeAsync(25_000));
    expect(api.resolveAvatarRefs).toHaveBeenCalledTimes(initial + 1);
  } finally {
    await act(async () => tree?.unmount());
    tree = undefined;
    jest.useRealTimers();
  }
});

test.each(['Ava', '@ava'])(
  'social identity %s shares authenticated bytes and revokes without changing its label',
  async (name) => {
    function SocialHarness() {
      useAvatarLifecycle('A', '/friends', 'a@example.com');
      return (
        <>
          <SocialIdentity name={name} userId="friend" avatarRef={ref} />
          <SocialIdentity name={name} userId="friend" avatarRef={ref} size={28} />
        </>
      );
    }
    await act(async () => {
      tree = create(<SocialHarness />);
    });
    expect(tree!.root.findAllByType(Image)).toHaveLength(2);
    expect(api.getAvatar).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(tree!.toJSON())).toContain(name);
    await act(async () => photoChanged('friend', { revision: 1, avatarRef: null }));
    expect(tree!.root.findAllByType(Image)).toHaveLength(0);
  },
);

test('social identity loading, absent photo and group monograms retain initials', async () => {
  jest
    .mocked(api.resolveAvatarRefs)
    .mockResolvedValue({ friend: { revision: 0, avatarRef: null } });
  function SocialHarness() {
    useAvatarLifecycle('A', '/friends', 'a@example.com');
    return (
      <>
        <SocialIdentity name="Ava" userId="friend" />
        <SocialIdentity name="Group" userId="not-a-person" avatarRef={ref} group />
      </>
    );
  }
  await act(async () => {
    tree = create(<SocialHarness />);
  });
  expect(tree!.root.findAllByType(Image)).toHaveLength(0);
  expect(api.getAvatar).not.toHaveBeenCalled();
  expect(JSON.stringify(tree!.toJSON())).toContain('Ava');
});

test('social identity waits for authoritative metadata before downloading a missing reference', async () => {
  let finish!: (value: Record<string, { revision: number; avatarRef: typeof ref }>) => void;
  jest.mocked(api.resolveAvatarRefs).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  function SocialHarness() {
    useAvatarLifecycle('A', '/friends', 'a@example.com');
    return <SocialIdentity name="@ava" userId="friend" />;
  }
  await act(async () => {
    tree = create(<SocialHarness />);
  });
  expect(api.getAvatar).not.toHaveBeenCalled();
  expect(tree!.root.findAllByType(Image)).toHaveLength(0);
  await act(async () => finish({ friend: { revision: 1, avatarRef: ref } }));
  expect(tree!.root.findAllByType(Image)).toHaveLength(1);
});

test('reportable photo identity follows rendered cache revision, not stale profile metadata', async () => {
  let reportedRevision: number | undefined;
  function ReportHarness() {
    useAvatarLifecycle('A', '/profile', 'a@example.com');
    const photo = useAvatarPhoto(ref, 'friend');
    React.useEffect(() => {
      reportedRevision = photo.ref?.revision;
    }, [photo.ref]);
    return <SocialIdentity name="Ava" userId="friend" avatarRef={ref} />;
  }
  await act(async () => {
    tree = create(<ReportHarness />);
  });
  expect(reportedRevision).toBe(1);
  await act(async () =>
    photoChanged('friend', { revision: 2, avatarRef: { userId: 'friend', revision: 2 } }),
  );
  expect(reportedRevision).toBe(2);
  jest.mocked(api.resolveAvatarRefs).mockRejectedValueOnce({ status: 403 });
  await act(async () => avatarCache.revalidate());
  expect(reportedRevision).toBeUndefined();
  expect(tree!.root.findAllByType(Image)).toHaveLength(0);
});
