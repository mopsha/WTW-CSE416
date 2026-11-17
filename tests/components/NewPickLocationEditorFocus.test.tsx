/** @jest-environment jsdom */
import React from 'react';
import {
  AccessibilityInfo,
  Modal,
  Platform,
  Text,
  type TextProps as MockTextProps,
} from 'react-native';
import { NewPickLocationEditor } from '@/components/NewPickLocationEditor';

// Model RN Web's DOM-backed Text ref without loading a native host component.
jest.mock('react-native/Libraries/Text/Text', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return {
    __esModule: true,
    default: React.forwardRef<HTMLElement, MockTextProps>(function WebText({ children }, ref) {
      return React.createElement('span', { ref }, children);
    }),
  };
});
jest.mock('expo-router', () => ({ router: {} }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/components/MapPicker', () => ({ MapPicker: () => null }));
jest.mock('@/components/LocationSearch', () => ({ LocationSearch: () => null }));
jest.mock('@react-native-community/slider', () => 'test-slider');
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => true }));

interface TestNode {
  props: Record<string, unknown>;
}
interface TestTree {
  root: {
    findByType(type: unknown): TestNode;
    findAllByType(type: unknown): TestNode[];
  };
  unmount(): void;
}
const { create, act } = jest.requireActual<{
  create(
    element: React.ReactElement,
    options: { createNodeMock(element: { type: unknown }): HTMLElement | null },
  ): TestTree;
  act(callback: () => void): Promise<void>;
}>('react-test-renderer');
let tree: TestTree;
let heading: HTMLElement;
const show = async () => {
  const onShow = tree.root.findByType(Modal).props.onShow;
  if (typeof onShow !== 'function') throw new Error('Expected modal onShow');
  await act(() => {
    onShow();
  });
};
beforeEach(async () => {
  jest.clearAllMocks();
  await act(() => {
    tree = create(
      <NewPickLocationEditor
        initial={{ center: { lat: 40, lng: -73 }, label: 'SBU', miles: 2 }}
        onCancel={jest.fn()}
        onApply={jest.fn()}
      />,
      {
        createNodeMock: ({ type }) => {
          if (type !== 'span') return null;
          const element = document.createElement('span');
          document.body.appendChild(element);
          // Only the editor heading has a forwarded ref in this fixture.
          heading = element;
          return element;
        },
      },
    );
  });
});
afterEach(async () => {
  await act(() => tree.unmount());
  jest.restoreAllMocks();
  document.body.replaceChildren();
});
test.each(['ios', 'android'] as const)(
  '%s retains an accessible heading and native focus event',
  async (platform) => {
    jest.replaceProperty(Platform, 'OS', platform);
    const focus = jest
      .spyOn(AccessibilityInfo, 'sendAccessibilityEvent')
      .mockImplementation(() => {});
    const title = tree.root
      .findAllByType(Text)
      .find((node) => node.props.accessibilityRole === 'header');
    expect(title?.props.accessible).toBe(true);
    expect(title?.props).not.toHaveProperty('tabIndex');
    await show();
    expect(focus).toHaveBeenCalledWith(heading, 'focus');
    expect(heading.hasAttribute('tabindex')).toBe(false);
  },
);
test('web focuses the DOM heading without adding a native Text prop or an extra tab stop', async () => {
  jest.replaceProperty(Platform, 'OS', 'web');
  const nativeFocus = jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent');
  await show();
  expect(heading.getAttribute('tabindex')).toBe('-1');
  expect(document.activeElement).toBe(heading);
  expect(nativeFocus).not.toHaveBeenCalled();
});
