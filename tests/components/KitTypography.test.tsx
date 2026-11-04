import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { Button } from '@/components/Button';
import { Segments } from '@/components/TabUi';
import { ActivePickPanel } from '@/components/picks/PicksHome';
import { fonts } from '@/components/theme';
import { haptic } from '@/lib/haptics';
const { create, act } = jest.requireActual('react-test-renderer');
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/lib/haptics', () => ({ haptic: { tap: jest.fn() } }));
beforeEach(() => jest.clearAllMocks());
test.each(['paper', 'primary'] as const)(
  '%s buttons keep the loaded semibold face and one kit haptic',
  async (variant) => {
    const onPress = jest.fn();
    let tree: any;
    await act(async () => {
      tree = create(<Button label="Start a Pick" variant={variant} onPress={onPress} />);
    });
    const label = tree.root
      .findAllByType(Text)
      .find((node: any) => node.props.children === 'Start a Pick');
    const style = StyleSheet.flatten(label.props.style);
    expect(style.fontFamily).toBe(fonts.semibold);
    expect(style.fontWeight).toBeUndefined();
    await act(async () =>
      tree.root
        .findAll(
          (node: any) =>
            node.props.accessibilityRole === 'button' && typeof node.props.onPress === 'function',
        )[0]
        .props.onPress(),
    );
    expect(haptic.tap).toHaveBeenCalledTimes(1);
    expect(onPress).toHaveBeenCalledTimes(1);
    await act(async () => tree.unmount());
  },
);
test('compact segments choose a loaded face instead of synthesizing a weight over regular text', async () => {
  let tree: any;
  await act(async () => {
    tree = create(
      <Segments
        variant="compact"
        label="People"
        value="friends"
        onChange={() => {}}
        options={[
          { value: 'friends', label: 'Friends' },
          { value: 'groups', label: 'Groups' },
        ]}
      />,
    );
  });
  const labels = tree.root.findAllByType(Text);
  expect(labels).toHaveLength(2);
  for (const label of labels) {
    const style = StyleSheet.flatten(label.props.style);
    expect(style.fontFamily).toBe(fonts.semibold);
    expect(style.fontWeight).toBeUndefined();
  }
  await act(async () => tree.unmount());
});
test('active Pick panels receive their tap haptic from Card exactly once', async () => {
  let tree: any;
  const onPress = jest.fn();
  await act(async () => {
    tree = create(
      <ActivePickPanel
        pick={{ id: 'pick', category: 'food', state: 'draft', deadlineAt: null }}
        onPress={onPress}
      />,
    );
  });
  await act(async () =>
    tree.root
      .findAll(
        (node: any) =>
          node.props.accessibilityRole === 'button' && typeof node.props.onPress === 'function',
      )[0]
      .props.onPress(),
  );
  expect(haptic.tap).toHaveBeenCalledTimes(1);
  expect(onPress).toHaveBeenCalledTimes(1);
  await act(async () => tree.unmount());
});
