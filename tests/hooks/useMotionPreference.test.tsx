import React from 'react';
import { AccessibilityInfo, Text } from 'react-native';
import { useMotionPreference } from '@/hooks/useMotionPreference';
const { act, create } = jest.requireActual('react-test-renderer');

test('motion starts conservatively, follows live OS changes, rejects stale reads and unsubscribes', async () => {
  let resolve!: (value: boolean) => void;
  const read = jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockImplementation(
    () =>
      new Promise<boolean>((yes) => {
        resolve = yes;
      }),
  );
  const remove = jest.fn();
  let change!: (value: boolean) => void;
  const listen = jest
    .spyOn(AccessibilityInfo, 'addEventListener')
    .mockImplementation((event, callback) => {
      expect(event).toBe('reduceMotionChanged');
      change = callback as unknown as (value: boolean) => void;
      return { remove } as unknown as ReturnType<typeof AccessibilityInfo.addEventListener>;
    });
  function Probe() {
    return <Text>{String(useMotionPreference())}</Text>;
  }
  let tree: any;
  try {
    await act(async () => {
      tree = create(<Probe />);
    });
    expect(tree.root.findByType(Text).props.children).toBe('true');
    await act(async () => change(false));
    expect(tree.root.findByType(Text).props.children).toBe('false');
    await act(async () => resolve(true));
    expect(tree.root.findByType(Text).props.children).toBe('false');
    await act(async () => change(true));
    expect(tree.root.findByType(Text).props.children).toBe('true');
    await act(async () => tree.unmount());
    tree = null;
    expect(remove).toHaveBeenCalledTimes(1);
    await act(async () => change(false));
  } finally {
    if (tree) await act(async () => tree.unmount());
    read.mockRestore();
    listen.mockRestore();
  }
});
