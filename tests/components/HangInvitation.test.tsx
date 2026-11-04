import React from 'react';
import { HangInvitation } from '@/components/picks/HangInvitation';
import type { HangPost } from '@shared/api/hang.ts';
const { create, act } = jest.requireActual('react-test-renderer');
jest.mock('@/components', () => ({
  Avatar: () => null,
  Button: (props: object) => jest.requireActual('react').createElement('test-button', props),
}));
const post: HangPost = {
  id: 'hang',
  authorId: 'me',
  activity: 'Study session',
  audience: 'all_friends',
  groupId: null,
  startsAt: '2026-11-03T17:00:00Z',
  expiresAt: '2026-11-03T20:00:00Z',
  downCount: 0,
  myStatus: 'maybe',
};
test('RSVP controls reflect actual state, forward unchanged values, and preserve host eligibility', async () => {
  const onRespond = jest.fn(),
    onStart = jest.fn();
  let tree!: ReturnType<typeof create>;
  const render = (p: HangPost, busy: string | null = null) => (
    <HangInvitation post={p} userId="me" busy={busy} onRespond={onRespond} onStart={onStart} />
  );
  await act(async () => {
    tree = create(render(post));
  });
  const response = (label: string) =>
    tree.root
      .findAllByProps({ accessibilityLabel: `${label}, Study session` })
      .find((n: { props: { onPress?: unknown } }) => typeof n.props.onPress === 'function');
  expect(response('Maybe').props.accessibilityState.selected).toBe(true);
  await act(async () => response('Down').props.onPress());
  expect(onRespond).toHaveBeenCalledWith('down');
  expect(tree.root.findByType('test-button').props.disabled).toBe(true);
  await act(async () => tree.update(render({ ...post, downCount: 2 })));
  expect(tree.root.findByType('test-button').props.disabled).toBe(false);
  await act(async () => tree.root.findByType('test-button').props.onPress());
  expect(onStart).toHaveBeenCalledTimes(1);
  await act(async () => tree.update(render(post, 'hang-down')));
  expect(response('Down').props.accessibilityState).toMatchObject({ disabled: true, busy: true });
  await act(async () => tree.update(render({ ...post, authorId: 'friend', authorName: 'Mike' })));
  expect(tree.root.findAllByType('test-button')).toHaveLength(0);
  expect(JSON.stringify(tree.toJSON())).toContain('Mike');
  await act(async () => tree.unmount());
});
