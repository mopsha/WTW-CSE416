import React from 'react';
import { StyleSheet } from 'react-native';
import { RequestsEntry } from '@/components/friends/SocialRow';
import { MIN_TARGET } from '@/components/theme';
const { act, create } = jest.requireActual('react-test-renderer');
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/components/Avatar', () => ({ Avatar: () => null }));
test('idle Requests stays reachable with real minimum geometry; pending, loading and errors retain visibility', async () => {
  const press = jest.fn();
  let tree: any;
  const render = (count: number, loading = false, error: string | null = null) => (
    <RequestsEntry count={count} loading={loading} error={error} onPress={press} />
  );
  await act(async () => {
    tree = create(render(0));
  });
  const entry = () =>
    tree.root.findAll(
      (n: any) =>
        n.props.accessibilityRole === 'button' &&
        typeof n.props.onPress === 'function' &&
        typeof n.props.style === 'function',
    )[0];
  const idle = StyleSheet.flatten(entry().props.style({ pressed: false }));
  expect(idle.minHeight).toBeGreaterThanOrEqual(MIN_TARGET);
  expect(entry().props.accessibilityLabel).toBe('Requests, 0 pending');
  await act(async () => entry().props.onPress());
  expect(press).toHaveBeenCalledTimes(1);
  await act(async () => tree.update(render(3)));
  expect(entry().props.accessibilityLabel).toBe('Requests, 3 pending');
  expect(
    StyleSheet.flatten(entry().props.style({ pressed: false })).minHeight,
  ).toBeGreaterThanOrEqual(idle.minHeight);
  await act(async () => tree.update(render(0, true)));
  expect(entry().props.accessibilityLabel).toContain('loading group invitations');
  await act(async () => tree.update(render(0, false, 'Could not refresh invitations')));
  expect(JSON.stringify(tree.toJSON())).toContain('Could not refresh invitations');
  await act(async () => tree.unmount());
});
