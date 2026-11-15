import React from 'react';
import { AccessibilityInfo, Modal, ScrollView, StyleSheet, Text } from 'react-native';
import { Sheet } from '@/components/TabUi';
import { Button } from '@/components/Button';
import { ProgressBar } from '@/components/ProgressBar';
import { MIN_TARGET, numeric } from '@/components/theme';
import { haptic } from '@/lib/haptics';
const { act, create } = jest.requireActual('react-test-renderer');
let mockReduced = false;
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => mockReduced }));
jest.mock('@/lib/haptics', () => ({ haptic: { tap: jest.fn() } }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

test('all explicit sheet dismissals share a guard; no drag affordance or simulated native gesture', async () => {
  const close = jest.fn();
  let tree: any;
  const render = (disabled: boolean) => (
    <Sheet visible title="Schedule" dismissDisabled={disabled} onClose={close}>
      <Text>Draft</Text>
    </Sheet>
  );
  await act(async () => {
    tree = create(render(true));
  });
  const modal = () => tree.root.findByType(Modal);
  const backdrop = () =>
    tree.root.findAll((n: any) => n.props.accessible === false && !!n.props.onPress)[0];
  const closeButton = () =>
    tree.root.findAll(
      (n: any) =>
        n.props.accessibilityLabel === 'Close Schedule' &&
        !!n.props.onPress &&
        typeof n.props.style === 'function',
    )[0];
  await act(async () => {
    modal().props.onRequestClose();
    backdrop().props.onPress();
  });
  expect(close).not.toHaveBeenCalled();
  expect(closeButton().props.accessibilityState.disabled).toBe(true);
  expect(modal().props.allowSwipeDismissal).toBeUndefined();
  await act(async () => tree.update(render(false)));
  await act(async () => {
    modal().props.onRequestClose();
    backdrop().props.onPress();
    closeButton().props.onPress();
  });
  expect(close).toHaveBeenCalledTimes(3);
  expect(tree.root.findByType(ScrollView).props.keyboardDismissMode).toBe('on-drag');
  await act(async () => tree.unmount());
});

test('sheet disables transitions for reduced motion and focuses the accessible heading on show', async () => {
  mockReduced = true;
  const focus = jest
    .spyOn(AccessibilityInfo, 'sendAccessibilityEvent')
    .mockImplementation(() => {});
  let tree: any;
  try {
    await act(async () => {
      tree = create(
        <Sheet visible title="Filters" onClose={() => {}}>
          <Text>Body</Text>
        </Sheet>,
        { createNodeMock: () => ({}) },
      );
    });
    const modal = tree.root.findByType(Modal);
    expect(modal.props.animationType).toBe('none');
    await act(async () => modal.props.onShow());
    expect(focus).toHaveBeenCalledWith(expect.anything(), 'focus');
  } finally {
    await act(async () => tree.unmount());
    focus.mockRestore();
    mockReduced = false;
  }
});

test('shared button uses static press feedback, disabled semantics and one tap haptic', async () => {
  jest.mocked(haptic.tap).mockClear();
  const press = jest.fn();
  let tree: any;
  await act(async () => {
    tree = create(<Button label="Save" onPress={press} />);
  });
  let control = tree.root.findAll(
    (n: any) => n.props.accessibilityLabel === 'Save' && typeof n.props.style === 'function',
  )[0];
  const pressed = StyleSheet.flatten(control.props.style({ pressed: true }));
  expect(pressed.opacity).toBeLessThan(1);
  expect(pressed.transform).toBeUndefined();
  await act(async () => control.props.onPress());
  expect(press).toHaveBeenCalledTimes(1);
  expect(haptic.tap).toHaveBeenCalledTimes(1);
  await act(async () => tree.update(<Button label="Save" loading onPress={press} />));
  control = tree.root.findAll(
    (n: any) => n.props.accessibilityLabel === 'Save' && typeof n.props.style === 'function',
  )[0];
  expect(control.props.disabled).toBe(true);
  expect(control.props.accessibilityState).toEqual({ disabled: true, busy: true });
  expect(MIN_TARGET).toBeGreaterThanOrEqual(44);
  await act(async () => tree.unmount());
});

test('live progress count opts into supported native tabular digits and retains its spoken value', async () => {
  let tree: any;
  await act(async () => {
    tree = create(<ProgressBar value={7} total={20} />);
  });
  const count = tree.root.findByType(Text);
  const style = StyleSheet.flatten(count.props.style);
  expect(style.fontVariant).toEqual(['tabular-nums']);
  expect(style.fontFamily).toBe(numeric.fontFamily);
  expect(
    tree.root.findAllByProps({ accessibilityRole: 'progressbar' })[0].props.accessibilityValue.text,
  ).toBe('7 of 20');
  await act(async () => tree.unmount());
});
