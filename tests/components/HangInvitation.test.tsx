import React from 'react';
import { router } from 'expo-router';
import { HangInvitation } from '@/components/picks/HangInvitation';
import type { HangPost } from '@shared/api/hang.ts';

const { create, act } = jest.requireActual('react-test-renderer');
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/components', () => ({ Avatar: () => null }));
jest.mock('@/components/MemberMenu', () => ({ MemberMenu: () => null }));
jest.mock('@/components/TabUi', () => ({
  Sheet: (props: { visible: boolean; children: React.ReactNode }) =>
    jest.requireActual('react').createElement('test-sheet', props, props.visible && props.children),
}));

const post: HangPost = {
  id: 'hang',
  authorId: 'me',
  authorName: 'Jordan',
  activity: 'Study session',
  audience: 'all_friends',
  groupId: null,
  startsAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 3600000).toISOString(),
  downCount: 5,
  canStartPick: true,
  maybeCount: 1,
  myStatus: 'maybe',
  attendees: [
    ...Array.from({ length: 5 }, (_, index) => ({
      userId: `friend-${index}`,
      displayName: `Friend ${index}`,
      username: `friend_${index}`,
      status: 'down' as const,
    })),
    { userId: 'me', displayName: 'Jordan', username: 'jordan', status: 'maybe' },
  ],
};

let tree: ReturnType<typeof create>;
const onRespond = jest.fn();
const onStart = jest.fn();
const render = (value = post, viewer = 'me', busy: string | null = null) => (
  <HangInvitation
    post={value}
    userId={viewer}
    busy={busy}
    onRespond={onRespond}
    onStart={onStart}
  />
);
const controls = (label: string) =>
  tree.root
    .findAllByProps({ accessibilityLabel: label })
    .filter((node: { props: { onPress?: unknown } }) => typeof node.props.onPress === 'function');
const press = async (label: string) => {
  await act(async () => controls(label)[0].props.onPress());
};

beforeEach(() => jest.clearAllMocks());
afterEach(async () => {
  await act(async () => tree.unmount());
});

test('keeps the RSVP controls and starts only from an explicit host menu action', async () => {
  await act(async () => {
    tree = create(render());
  });
  expect(controls('Maybe, Study session')[0].props.accessibilityState.selected).toBe(true);
  await press("I'm in, Study session");
  expect(onRespond).toHaveBeenCalledWith('down');
  expect(controls('Start a Pick')).toHaveLength(0);
  await press('Hang options');
  expect(onStart).not.toHaveBeenCalled();
  await press('Start a Pick');
  const hostSheet = tree.root
    .findAllByType('test-sheet')
    .find((sheet: { props: { title: string } }) => sheet.props.title === 'Hang options');
  expect(onStart).not.toHaveBeenCalled();
  await act(async () => hostSheet.props.onDismiss());
  expect(onStart).toHaveBeenCalledTimes(1);

  await act(async () => tree.update(render(post, 'me', 'hang-down')));
  expect(controls("I'm in, Study session")[0].props.accessibilityState).toMatchObject({
    disabled: true,
    busy: true,
  });
  expect(controls('Hang options')).toHaveLength(0);
  await act(async () => tree.update(render({ ...post, pickId: 'active', canStartPick: false })));
  expect(controls('Hang options')).toHaveLength(0);
  expect(controls('Maybe, Study session')[0].props.accessibilityState.disabled).toBe(false);
  await act(async () => tree.update(render(post, 'guest')));
  expect(controls('Hang options')).toHaveLength(0);
});

test('previews four attendees, opens both tabs, and routes avatar and sheet taps to profiles', async () => {
  await act(async () => {
    tree = create(render());
  });
  expect(controls('Open Friend 4’s profile')).toHaveLength(0);
  await press('Open Friend 0’s profile');
  expect(router.push).toHaveBeenLastCalledWith({
    pathname: '/users/[id]',
    params: { id: 'friend-0', hangId: 'hang' },
  });
  await press('View all 5 Down attendees');
  expect(controls('Down, 5')[0].props.accessibilityState.selected).toBe(true);
  expect(controls('Open Friend 4’s profile, @friend_4').length).toBeGreaterThan(0);
  await press('Maybe, 1');
  expect(controls('Maybe, 1')[0].props.accessibilityState.selected).toBe(true);
  await press('Open Jordan’s profile, @jordan');
  const attendeeSheet = tree.root
    .findAllByType('test-sheet')
    .find((sheet: { props: { title: string } }) => sheet.props.title === "Who's coming?");
  await act(async () => attendeeSheet.props.onDismiss());
  expect(router.push).toHaveBeenLastCalledWith({
    pathname: '/users/[id]',
    params: { id: 'me', hangId: 'hang' },
  });

  await act(async () =>
    tree.update(
      render({
        ...post,
        maybeCount: 0,
        attendees: post.attendees?.filter((p) => p.status === 'down'),
      }),
    ),
  );
  await press('View Maybe attendees, 0');
  expect(JSON.stringify(tree.toJSON())).toContain('No maybes yet.');
});

test('an open attendee sheet drops identities and counts when the refreshed card revokes them', async () => {
  await act(async () => {
    tree = create(render());
  });
  await press('View Down attendees, 5');
  expect(controls('Open Friend 4’s profile, @friend_4').length).toBeGreaterThan(0);
  await act(async () =>
    tree.update(
      render({
        ...post,
        canStartPick: false,
        downCount: 0,
        attendees: post.attendees?.filter((person) => person.userId === 'me'),
      }),
    ),
  );
  expect(controls('Open Friend 4’s profile, @friend_4')).toHaveLength(0);
  expect(controls('Down, 0')[0].props.accessibilityState.selected).toBe(true);
  expect(JSON.stringify(tree.toJSON())).toContain('No one is down yet.');
});
