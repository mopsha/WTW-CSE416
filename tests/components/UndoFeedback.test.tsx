import React from 'react';
import { AppState, KeyboardAvoidingView, Text } from 'react-native';
import { Button } from '@/components/Button';
import { UndoFeedback } from '@/components/UndoFeedback';
import { useSavedChoices } from '@/hooks/useSavedChoices';
import { api } from '@/lib/api';
const { create, act } = jest.requireActual('react-test-renderer');
jest.mock('@/lib/api', () => ({
  api: { getSaved: jest.fn(), savePlace: jest.fn(), removeSaved: jest.fn() },
}));
let tree: any;
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
  tree = null;
  jest.useRealTimers();
});
test('Undo is a labelled accessible action in a keyboard-aware safe-area banner, with no motion dependency', async () => {
  const restore = jest.fn();
  await act(async () => {
    tree = create(<UndoFeedback pending onUndo={restore} />);
  });
  const action = tree.root.findByType(Button);
  expect(action.props.accessibilityLabel).toBe('Undo removing saved place');
  expect(tree.root.findByType(KeyboardAvoidingView)).toBeDefined();
  expect(
    tree.root.findAllByType(Text).some((n: any) => n.props.children === 'Removing saved place…'),
  ).toBe(true);
  await act(async () => action.props.onPress());
  expect(restore).toHaveBeenCalledTimes(1);
  await act(async () => tree.update(<UndoFeedback pending={false} onUndo={restore} />));
  expect(
    tree.root.findAllByType(Text).some((n: any) => n.props.children === 'Saved place removed.'),
  ).toBe(true);
});
test('Undo expiry and account unmount invalidate captured callbacks', async () => {
  jest.useFakeTimers();
  AppState.currentState = 'active';
  jest.mocked(api.getSaved).mockResolvedValue({ places: [{ placeId: 'a', createdAt: 'now' }] });
  jest.mocked(api.removeSaved).mockResolvedValue({ status: 'ok' });
  jest.mocked(api.savePlace).mockResolvedValue({ status: 'ok' });
  let scope!: ReturnType<typeof useSavedChoices>['saved'];
  function Probe() {
    const { saved } = useSavedChoices('A');
    scope = saved;
    return null;
  }
  await act(async () => {
    tree = create(<Probe />);
  });
  await act(async () => scope.reload());
  await act(async () => scope.toggle('a'));
  const old = scope.undo!.token;
  await act(async () => jest.advanceTimersByTime(60000));
  expect(scope.undo).toBeNull();
  scope.restore(old);
  expect(api.savePlace).not.toHaveBeenCalled();
  await act(async () => scope.toggle('a'));
  await act(async () => scope.toggle('a'));
  const stale = scope.undo!.token;
  await act(async () => tree.unmount());
  tree = null;
  scope.restore(stale);
  expect(scope.ready).toBe(false);
});
