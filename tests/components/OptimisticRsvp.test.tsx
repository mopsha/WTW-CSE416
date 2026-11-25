import { router } from 'expo-router';
import React from 'react';
import { AppState, Modal, Platform, type AppStateStatus } from 'react-native';
import { PlanBlock } from '@/components/PlanBlock';
import { HangCard } from '@/components/HangCard';
import { HangInvitation } from '@/components/picks/HangInvitation';
import { Chips } from '@/components/Chips';
import { api } from '@/lib/api';
import type { PlanSummary } from '@shared/api/plans.ts';
import type { HangPost } from '@shared/api/hang.ts';
const { create, act } = jest.requireActual('react-test-renderer');
let mockUser = 'A';
jest.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ session: { user: { id: mockUser } } }) }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
  useFocusEffect: (fn: () => void) => jest.requireActual('react').useEffect(fn, [fn]),
}));
jest.mock('@/lib/api', () => ({
  api: { getPlan: jest.fn(), rsvp: jest.fn(), getHang: jest.fn(), respondHang: jest.fn() },
}));
jest.mock('@/components/HangPlanComposer', () => ({ HangPlanComposer: () => null }));
jest.mock('@/components/MemberMenu', () => ({ MemberMenu: () => null }));
jest.mock('@/components/Avatar', () => ({ Avatar: () => null, AvatarStack: () => null }));
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => true }));
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
let tree: any;
let stateChange: (s: AppStateStatus) => void;
const plan = (): PlanSummary => ({
  state: 'completed',
  isHost: false,
  planAt: null,
  participantCount: 4,
  rsvps: { going: 1, maybe: 1, notGoing: 0 },
  myRsvp: 'maybe',
  outcomes: { went: 0, didNotGo: 0, again: 0 },
  myOutcome: null,
});
const post = (): HangPost => ({
  id: 'hang',
  authorId: 'other',
  authorName: 'Friend',
  activity: 'Walk',
  startsAt: new Date(Date.now() + 1000).toISOString(),
  expiresAt: new Date(Date.now() + 86400000).toISOString(),
  audience: 'all_friends',
  groupId: null,
  downCount: 2,
  myStatus: 'maybe',
});
beforeEach(() => {
  jest.clearAllMocks();
  mockUser = 'A';
  AppState.currentState = 'active';
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, fn) => {
    stateChange = fn;
    return { remove: jest.fn() };
  });
  jest.mocked(api.getPlan).mockResolvedValue(plan());
  jest
    .mocked(api.getHang)
    .mockResolvedValue({ posts: [post()], sharedAvailable: true, notice: '' });
});
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
  tree = null;
  jest.useRealTimers();
});
const text = () => JSON.stringify(tree.toJSON());
async function mountPlan(viewer = 'A') {
  await act(async () => {
    tree = create(<PlanBlock viewerId={viewer} pickId="pick" decidedAt={null} />);
  });
}

test('Pick selection and totals change before the deferred RSVP completes, then reconcile other participants', async () => {
  const first = deferred<{ status: 'ok' }>();
  jest.mocked(api.rsvp).mockReturnValueOnce(first.promise);
  await mountPlan();
  await act(async () => tree.root.findByType(Chips).props.onChange('going'));
  expect(tree.root.findByType(Chips).props.value).toBe('going');
  expect(text()).toContain('2 going · 0 maybe');
  jest
    .mocked(api.getPlan)
    .mockResolvedValue({ ...plan(), myRsvp: 'going', rsvps: { going: 3, maybe: 0, notGoing: 0 } });
  await act(async () => first.resolve({ status: 'ok' }));
  expect(text()).toContain('3 going · 0 maybe');
  expect(api.rsvp).toHaveBeenCalledWith('pick', 'going', 'A');
});
test('rapid Pick choices serialize and preserve the most recent selection', async () => {
  const first = deferred<{ status: 'ok' }>();
  const second = deferred<{ status: 'ok' }>();
  jest.mocked(api.rsvp).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  await mountPlan();
  await act(async () => {
    tree.root.findByType(Chips).props.onChange('going');
    tree.root.findByType(Chips).props.onChange('not_going');
  });
  expect(api.rsvp).toHaveBeenCalledTimes(1);
  expect(tree.root.findByType(Chips).props.value).toBe('not_going');
  jest.mocked(api.getPlan).mockResolvedValueOnce({
    ...plan(),
    myRsvp: 'going',
    rsvps: { going: 2, maybe: 0, notGoing: 0 },
  });
  await act(async () => first.resolve({ status: 'ok' }));
  expect(api.rsvp).toHaveBeenCalledTimes(2);
  jest.mocked(api.getPlan).mockResolvedValue({
    ...plan(),
    myRsvp: 'not_going',
    rsvps: { going: 1, maybe: 0, notGoing: 1 },
  });
  await act(async () => second.resolve({ status: 'ok' }));
  expect(tree.root.findByType(Chips).props.value).toBe('not_going');
});
test('definitive RSVP failure restores the prior choice and summary', async () => {
  const first = deferred<{ status: 'ok' }>();
  jest.mocked(api.rsvp).mockReturnValueOnce(first.promise);
  await mountPlan();
  await act(async () => tree.root.findByType(Chips).props.onChange('going'));
  await act(async () =>
    first.reject(Object.assign(new Error('Rejected response'), { status: 400 })),
  );
  expect(tree.root.findByType(Chips).props.value).toBe('maybe');
  expect(text()).toContain('1 going · 1 maybe');
  expect(text()).toContain('Rejected response');
});
test('revocation removes protected counts; a queued choice cannot revive them', async () => {
  const first = deferred<{ status: 'ok' }>();
  jest.mocked(api.rsvp).mockReturnValueOnce(first.promise);
  await mountPlan();
  await act(async () => {
    tree.root.findByType(Chips).props.onChange('going');
    tree.root.findByType(Chips).props.onChange('not_going');
  });
  await act(async () => first.reject(Object.assign(new Error('Denied'), { status: 403 })));
  expect(tree.root.findAllByType(Chips)).toHaveLength(0);
  expect(api.rsvp).toHaveBeenCalledTimes(1);
});
test('an account switch during a pending RSVP ignores its late response and does not read as the new account', async () => {
  const first = deferred<{ status: 'ok' }>();
  jest.mocked(api.rsvp).mockReturnValueOnce(first.promise);
  await mountPlan();
  await act(async () => tree.root.findByType(Chips).props.onChange('going'));
  jest
    .mocked(api.getPlan)
    .mockResolvedValue({ ...plan(), myRsvp: null, rsvps: { going: 0, maybe: 0, notGoing: 0 } });
  await act(async () => tree.update(<PlanBlock viewerId="B" pickId="pick" decidedAt={null} />));
  const reads = jest.mocked(api.getPlan).mock.calls.length;
  await act(async () => first.resolve({ status: 'ok' }));
  expect(api.getPlan).toHaveBeenCalledTimes(reads);
  expect(tree.root.findByType(Chips).props.value).toBe('');
});
test('background clears a pending projection and late completion cannot restore it', async () => {
  const first = deferred<{ status: 'ok' }>();
  jest.mocked(api.rsvp).mockReturnValueOnce(first.promise);
  await mountPlan();
  await act(async () => tree.root.findByType(Chips).props.onChange('going'));
  await act(async () => stateChange('background'));
  await act(async () => first.resolve({ status: 'ok' }));
  expect(tree.root.findAllByType(Chips)).toHaveLength(0);
});
test('Hang selection and Down count update immediately and do not block later intent', async () => {
  const first = deferred<{ status: 'ok' }>();
  jest.mocked(api.respondHang).mockReturnValueOnce(first.promise);
  await act(async () => {
    tree = create(<HangCard />);
  });
  await act(async () => tree.root.findByType(HangInvitation).props.onRespond('down'));
  expect(tree.root.findByType(HangInvitation).props.post).toMatchObject({
    myStatus: 'down',
    downCount: 3,
  });
  await act(async () => tree.root.findByType(HangInvitation).props.onRespond('cant'));
  expect(tree.root.findByType(HangInvitation).props.post).toMatchObject({
    myStatus: 'cant',
    downCount: 2,
  });
  expect(api.respondHang).toHaveBeenCalledTimes(1);
  // Leaving the account discards the queued second response.
  mockUser = 'B';
  jest.mocked(api.getHang).mockResolvedValue({ posts: [], sharedAvailable: true, notice: '' });
  await act(async () => tree.update(<HangCard />));
  await act(async () => first.resolve({ status: 'ok' }));
  expect(api.respondHang).toHaveBeenCalledTimes(1);
  expect(tree.root.findAllByType(HangInvitation)).toHaveLength(0);
});
test('a newer authoritative cancellation during a pending RSVP suppresses its late acknowledgement', async () => {
  jest.useFakeTimers();
  const first = deferred<{ status: 'ok' }>();
  jest.mocked(api.rsvp).mockReturnValueOnce(first.promise);
  await mountPlan();
  await act(async () => tree.root.findByType(Chips).props.onChange('going'));
  jest.mocked(api.getPlan).mockResolvedValue({ ...plan(), state: 'canceled' });
  await act(async () => jest.advanceTimersByTime(30000));
  expect(tree.root.findAllByType(Chips)).toHaveLength(0);
  await act(async () => first.resolve({ status: 'ok' }));
  expect(tree.root.findAllByType(Chips)).toHaveLength(0);
});

test('Strict Mode effect replay revalidates the choice instead of leaving it permanently disposed', async () => {
  await act(async () => {
    tree = create(
      <React.StrictMode>
        <PlanBlock viewerId="A" pickId="pick" decidedAt={null} />
      </React.StrictMode>,
    );
  });
  expect(tree.root.findByType(Chips).props.value).toBe('maybe');
  const first = deferred<{ status: 'ok' }>();
  jest.mocked(api.rsvp).mockReturnValueOnce(first.promise);
  await act(async () => tree.root.findByType(Chips).props.onChange('going'));
  expect(tree.root.findByType(Chips).props.value).toBe('going');
  await act(async () => first.resolve({ status: 'ok' }));
});

test('Hang poll snapshots include concurrent participants without adding our optimistic Down twice', async () => {
  jest.useFakeTimers();
  const first = deferred<{ status: 'ok' }>();
  jest.mocked(api.respondHang).mockReturnValueOnce(first.promise);
  await act(async () => {
    tree = create(<HangCard />);
  });
  await act(async () => tree.root.findByType(HangInvitation).props.onRespond('down'));
  jest.mocked(api.getHang).mockResolvedValue({
    posts: [{ ...post(), myStatus: 'down', downCount: 4 }],
    sharedAvailable: true,
    notice: '',
  });
  await act(async () => jest.advanceTimersByTime(30000));
  expect(tree.root.findByType(HangInvitation).props.post.downCount).toBe(4);
  jest.mocked(api.getHang).mockResolvedValue({
    posts: [{ ...post(), myStatus: 'down', downCount: 5 }],
    sharedAvailable: true,
    notice: '',
  });
  await act(async () => first.resolve({ status: 'ok' }));
  expect(tree.root.findByType(HangInvitation).props.post.downCount).toBe(5);
  // A failed later poll must not promote its retained, older feed payload to a fresh snapshot.
  jest.mocked(api.getHang).mockRejectedValueOnce(new Error('Offline'));
  await act(async () => jest.advanceTimersByTime(30000));
  expect(tree.root.findByType(HangInvitation).props.post.downCount).toBe(5);
});

test('a deleted or inaccessible Hang disappears during a pending response and cannot return from its acknowledgement', async () => {
  jest.useFakeTimers();
  const first = deferred<{ status: 'ok' }>();
  jest.mocked(api.respondHang).mockReturnValueOnce(first.promise);
  await act(async () => {
    tree = create(<HangCard />);
  });
  await act(async () => tree.root.findByType(HangInvitation).props.onRespond('down'));
  jest.mocked(api.getHang).mockResolvedValue({ posts: [], sharedAvailable: true, notice: '' });
  await act(async () => jest.advanceTimersByTime(30000));
  const reads = jest.mocked(api.getHang).mock.calls.length;
  await act(async () => first.resolve({ status: 'ok' }));
  expect(tree.root.findAllByType(HangInvitation)).toHaveLength(0);
  expect(api.getHang).toHaveBeenCalledTimes(reads);
});

test('a Hang that already started a Pick stays visible and can still take RSVPs', async () => {
  jest.mocked(api.getHang).mockResolvedValue({
    posts: [{ ...post(), pickId: 'pick' }],
    sharedAvailable: true,
    notice: '',
  });
  jest.mocked(api.respondHang).mockResolvedValue({ status: 'ok' });
  await act(async () => {
    tree = create(<HangCard />);
  });
  const invitation = tree.root.findByType(HangInvitation);
  expect(invitation.props.disabled).toBe(false);
  expect(text()).not.toContain('no longer available');
  await act(async () => invitation.props.onRespond('down'));
  expect(api.respondHang).toHaveBeenCalledWith('hang', 'down', 'A');
});

test('eligible hosts open Start a Pick from the Hang menu and navigate with the original Hang identity', async () => {
  jest.mocked(api.getHang).mockResolvedValue({
    posts: [{ ...post(), authorId: 'A', pickId: 'existing-draft', canStartPick: true }],
    sharedAvailable: true,
    notice: '',
  });
  await act(async () => {
    tree = create(<HangCard />);
  });
  const invitation = tree.root.findByType(HangInvitation);
  expect(invitation.props.disabled).toBe(false);
  const action = (label: string) =>
    invitation
      .findAllByProps({ accessibilityLabel: label })
      .find((node: { props: { onPress?: unknown } }) => typeof node.props.onPress === 'function');
  expect(action('Start a Pick')).toBeUndefined();
  await act(async () => action('Hang options').props.onPress());
  expect(router.push).not.toHaveBeenCalled();

  const start = action('Start a Pick');
  expect(start.props.disabled).toBeFalsy();
  const menu = invitation
    .findAllByType(Modal)
    .find((node: { props: { visible: boolean } }) => node.props.visible);
  await act(async () => start.props.onPress());
  if (Platform.OS === 'ios') {
    expect(router.push).not.toHaveBeenCalled();
    await act(async () => menu.props.onDismiss());
  }
  expect(router.push).toHaveBeenCalledTimes(1);
  expect(router.push).toHaveBeenCalledWith({
    pathname: '/pick/new',
    params: { hangId: 'hang', hangActivity: 'Walk' },
  });
  expect(tree.root.findByType(HangInvitation).props.post).toMatchObject({
    id: 'hang',
    pickId: 'existing-draft',
  });
});

test.each([
  { authorId: 'A', canStartPick: false },
  { authorId: 'other', canStartPick: true },
])(
  'the Hang menu requires both host ownership and server eligibility (%o)',
  async (eligibility) => {
    jest.mocked(api.getHang).mockResolvedValue({
      posts: [{ ...post(), pickId: 'existing-draft', ...eligibility }],
      sharedAvailable: true,
      notice: '',
    });
    await act(async () => {
      tree = create(<HangCard />);
    });
    const invitation = tree.root.findByType(HangInvitation);
    expect(invitation.findAllByProps({ accessibilityLabel: 'Hang options' })).toHaveLength(0);
    expect(router.push).not.toHaveBeenCalled();
  },
);

test('scheduled RSVP carries the revision the participant saw when choosing', async () => {
  const first = deferred<{ status: 'ok' }>();
  jest.mocked(api.getPlan).mockResolvedValue({
    ...plan(),
    planAt: new Date(Date.now() + 86400000).toISOString(),
    scheduleRevision: 3,
  });
  jest.mocked(api.rsvp).mockReturnValueOnce(first.promise);
  await mountPlan();
  await act(async () => tree.root.findByType(Chips).props.onChange('going'));
  expect(api.rsvp).toHaveBeenCalledWith('pick', 'going', 'A', 3);
  await act(async () => first.resolve({ status: 'ok' }));
});

test('Hang refresh reconciles the selected RSVP, both counts, and the attendee tab together', async () => {
  const viewer = { userId: 'A', displayName: 'Alex', username: 'alex' };
  const friend = { userId: 'B', displayName: 'Blair', username: 'blair' };
  const initial: HangPost = {
    ...post(),
    viewer,
    downCount: 1,
    maybeCount: 1,
    attendees: [
      { ...friend, status: 'down' },
      { ...viewer, status: 'maybe' },
    ],
  };
  const write = deferred<{ status: 'ok' }>();
  jest.mocked(api.respondHang).mockReturnValueOnce(write.promise);
  jest
    .mocked(api.getHang)
    .mockResolvedValue({ posts: [initial], sharedAvailable: true, notice: '' });
  await act(async () => {
    tree = create(<HangCard />);
  });
  const control = (label: string) =>
    tree.root
      .findAllByProps({ accessibilityLabel: label })
      .find((node: any) => typeof node.props.onPress === 'function');
  expect(control('Maybe, Walk').props.accessibilityState.selected).toBe(true);
  expect(control('View attendees, 1 down, 1 maybe')).toBeDefined();
  await act(async () => control("I'm in, Walk").props.onPress());
  expect(control("I'm in, Walk").props.accessibilityState.selected).toBe(true);
  await act(async () => control('View attendees, 2 down, 0 maybe').props.onPress());
  expect(control('Open Alex’s profile, @alex')).toBeDefined();
  await act(async () => control('Maybe, 0').props.onPress());
  expect(control('Open Alex’s profile, @alex')).toBeUndefined();

  const confirmed: HangPost = {
    ...initial,
    myStatus: 'down',
    downCount: 1,
    maybeCount: 1,
    attendees: [
      { ...viewer, status: 'down' },
      { ...friend, status: 'maybe' },
    ],
  };
  jest
    .mocked(api.getHang)
    .mockResolvedValue({ posts: [confirmed], sharedAvailable: true, notice: '' });
  await act(async () => write.resolve({ status: 'ok' }));
  expect(control("I'm in, Walk").props.accessibilityState.selected).toBe(true);
  expect(control('Maybe, Walk').props.accessibilityState.selected).toBe(false);
  expect(control('View attendees, 1 down, 1 maybe')).toBeDefined();
  expect(control('Open Blair’s profile, @blair')).toBeDefined();
  await act(async () => control('Down, 1').props.onPress());
  expect(control('Open Alex’s profile, @alex')).toBeDefined();
  expect(control('Open Blair’s profile, @blair')).toBeUndefined();
});
