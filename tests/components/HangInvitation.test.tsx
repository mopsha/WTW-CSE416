import React from 'react';
import { router } from 'expo-router';
import { Screen } from '@/components/Screen';
import { HangInvitation } from '@/components/picks/HangInvitation';
import type { HangPost } from '@shared/api/hang.ts';

const { create, act } = jest.requireActual('react-test-renderer');
jest.mock('expo-router', () => ({
  router: { navigate: jest.fn(), canGoBack: jest.fn(), back: jest.fn() },
}));
jest.mock('@/hooks/useAvatarSource', () => ({ useAvatarPhoto: () => ({ uri: null }) }));
jest.mock('@/components', () => jest.requireActual('@/components/Avatar'));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
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
const render = (value = post, viewer = 'me', busy: string | null = null, singlePost = false) => (
  <HangInvitation
    post={value}
    userId={viewer}
    busy={busy}
    singlePost={singlePost}
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

beforeEach(() => jest.resetAllMocks());
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
  await act(async () => tree.update(render({ ...post, myStatus: 'down' })));
  expect(controls("I'm in, Study session")[0].props.accessibilityState.selected).toBe(true);
  expect(controls('Maybe, Study session')[0].props.accessibilityState.selected).toBe(false);
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

async function finishAttendeeDismissal() {
  const sheet = tree.root
    .findAllByType('test-sheet')
    .find((node: { props: { title: string } }) => node.props.title === "Who's coming?");
  await act(async () => sheet.props.onDismiss());
}

test('summary opens the existing list, and attendee rows open profiles by ID after dismissal', async () => {
  await act(async () => {
    tree = create(render());
  });
  expect(JSON.stringify(tree.toJSON())).toContain('5 down · 1 maybe');
  expect(controls('Open Friend 0’s profile')).toHaveLength(1);
  await press('View attendees, 5 down, 1 maybe');
  expect(controls('Down, 5')[0].props.accessibilityState.selected).toBe(true);
  await press('Open Friend 4’s profile, @friend_4');
  expect(router.navigate).not.toHaveBeenCalled();
  await finishAttendeeDismissal();
  expect(router.navigate).toHaveBeenLastCalledWith({
    pathname: '/users/[id]',
    params: { id: 'friend-4', hangId: 'hang' },
  });
  expect(onRespond).not.toHaveBeenCalled();

  await press('View attendees, 5 down, 1 maybe');
  await press('Maybe, 1');
  expect(controls('Maybe, 1')[0].props.accessibilityState.selected).toBe(true);
  await press('Open Jordan’s profile, @jordan');
  await finishAttendeeDismissal();
  expect(router.navigate).toHaveBeenLastCalledWith('/(tabs)/profile');

  await act(async () => tree.update(render(post, 'me', null, true)));
  await press('Open Jordan’s profile');
  expect(router.navigate).toHaveBeenLastCalledWith({
    pathname: '/users/[id]',
    params: { id: 'me' },
  });
});

test('the summary handles no attendees and uses initials when an authorized photo is missing', async () => {
  await act(async () => {
    tree = create(render({ ...post, downCount: 0, maybeCount: 0, attendees: [] }));
  });
  await press('View attendees, 0 down, 0 maybe');
  expect(JSON.stringify(tree.toJSON())).toContain('No one is down yet.');
  await press('Maybe, 0');
  expect(JSON.stringify(tree.toJSON())).toContain('No maybes yet.');

  await act(async () =>
    tree.update(
      render({
        ...post,
        downCount: 0,
        attendees: [{ userId: 'new', displayName: null, username: null, status: 'maybe' }],
      }),
    ),
  );
  const row = controls('Open WTW member’s profile').at(-1)!;
  expect(
    row.findAllByProps({ accessibilityRole: 'image', accessibilityLabel: 'WTW member' }).length,
  ).toBeGreaterThan(0);
  expect(JSON.stringify(tree.toJSON())).toContain('WM');
});

test('an open attendee sheet drops identities and counts when the refreshed card revokes them', async () => {
  await act(async () => {
    tree = create(render());
  });
  await press('View attendees, 5 down, 1 maybe');
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

test('a revoked attendee is not opened after the sheet finishes dismissing', async () => {
  await act(async () => {
    tree = create(render());
  });
  await press('View attendees, 5 down, 1 maybe');
  await press('Open Friend 4’s profile, @friend_4');
  await act(async () =>
    tree.update(render({ ...post, downCount: 0, maybeCount: 0, attendees: [] })),
  );
  await finishAttendeeDismissal();
  expect(router.navigate).not.toHaveBeenCalled();
});

test('preview avatar buttons open authorized profiles without opening the attendee sheet or responding', async () => {
  await act(async () => {
    tree = create(render());
  });
  for (const index of [0, 1, 2]) {
    await press(`Open Friend ${index}’s profile`);
    expect(router.navigate).toHaveBeenLastCalledWith({
      pathname: '/users/[id]',
      params: { id: `friend-${index}`, hangId: 'hang' },
    });
    expect(controls('Down, 5')).toHaveLength(0);
  }
  expect(onRespond).not.toHaveBeenCalled();

  await press('View attendees, 5 down, 1 maybe');
  expect(controls('Down, 5')).toHaveLength(1);
  expect(router.navigate).toHaveBeenCalledTimes(3);
});

test('the signed-in attendee avatar opens the existing Profile tab from Picks', async () => {
  await act(async () => {
    tree = create(render({ ...post, downCount: 0, attendees: post.attendees?.slice(-1) }));
  });
  // Both the author and the only attendee are Jordan.
  await act(async () => controls('Open Jordan’s profile').at(-1)!.props.onPress());
  expect(router.navigate).toHaveBeenCalledTimes(1);
  expect(router.navigate).toHaveBeenCalledWith('/(tabs)/profile');
  expect(controls('Maybe, 1')).toHaveLength(0);
});

test('a rapid second row tap cannot change the destination or navigate twice', async () => {
  await act(async () => {
    tree = create(render());
  });
  await press('View attendees, 5 down, 1 maybe');
  const first = controls('Open Friend 0’s profile, @friend_0')[0].props.onPress;
  const second = controls('Open Friend 1’s profile, @friend_1')[0].props.onPress;
  const switchTab = controls('Maybe, 1')[0].props.onPress;
  await act(async () => {
    first();
    second();
    switchTab();
  });
  expect(controls('Maybe, 1')).toHaveLength(0);
  expect(router.navigate).not.toHaveBeenCalled();
  await finishAttendeeDismissal();
  await act(async () => second());
  await finishAttendeeDismissal();
  expect(router.navigate).toHaveBeenCalledTimes(1);
  expect(router.navigate).toHaveBeenCalledWith({
    pathname: '/users/[id]',
    params: { id: 'friend-0', hangId: 'hang' },
  });
  await press('View attendees, 5 down, 1 maybe');
  expect(controls('Down, 5')).toHaveLength(1);
});

test.each(['Open Jordan’s profile', 'Open Friend 0’s profile'])(
  'Back from a standalone Hang profile returns to the same Hang (%s)',
  async (label) => {
    const { StackRouter } = jest.requireActual(
      'expo-router/build/react-navigation/routers/StackRouter',
    );
    const stack = StackRouter({ initialRouteName: 'hang/[id]' });
    const options = {
      routeNames: ['hang/[id]', 'users/[id]'],
      routeParamList: { 'hang/[id]': { id: 'hang' } },
      routeGetIdList: {},
    };
    const original = stack.getInitialState(options);
    let state = original;
    jest.mocked(router.navigate).mockImplementation((href) => {
      if (typeof href === 'string') throw new Error('Expected a profile stack route');
      state = stack.getStateForAction(
        state,
        {
          type: 'NAVIGATE',
          payload: { name: href.pathname.slice(1), params: href.params },
        },
        options,
      );
    });
    jest.mocked(router.canGoBack).mockImplementation(() => state.index > 0);
    jest.mocked(router.back).mockImplementation(() => {
      state = stack.getStateForAction(state, { type: 'GO_BACK' }, options);
    });

    await act(async () => {
      tree = create(render(post, 'me', null, true));
    });
    await press(label);
    expect(state.routes[state.index].name).toBe('users/[id]');
    expect(state.routes[state.index].params.id).toBe(label.includes('Jordan') ? 'me' : 'friend-0');

    await act(async () =>
      tree.update(
        <Screen back>
          <></>
        </Screen>,
      ),
    );
    await press('Back');
    expect(state.routes[state.index]).toEqual(original.routes[0]);
  },
);
