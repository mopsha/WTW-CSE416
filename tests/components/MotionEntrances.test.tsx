import React from 'react';
import { AccessibilityInfo, Modal, Text, View } from 'react-native';
import { Sheet } from '@/components/TabUi';
import { ActivityToast } from '@/components/ActivityToast';
import { useMotionPreference } from '@/hooks/useMotionPreference';
import { cancelAnimation, withSpring, withTiming } from 'react-native-reanimated';
const { act, create } = jest.requireActual('react-test-renderer');
let mockInitial = false;
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: jest.requireActual('react-native').View,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: jest.requireActual('react-native').View },
  useReducedMotion: () => mockInitial,
  useSharedValue: (initial: number) =>
    jest.requireActual('react').useRef({ value: initial }).current,
  useAnimatedStyle: (fn: () => unknown) => fn(),
  withSpring: jest.fn((value) => value),
  withTiming: jest.fn((value) => value),
  cancelAnimation: jest.fn(),
}));

// Keep the OS query pending: assertions must observe first-mount configuration, not eventual state.
test.each([false, true])(
  'already-visible sheet and entrance receive synchronous Reduce Motion=%s',
  async (reduced) => {
    mockInitial = reduced;
    const query = jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockReturnValue(new Promise(() => {}));
    const first: boolean[] = [];
    function Entrance() {
      const preference = useMotionPreference();
      first.push(preference);
      return <View testID={preference ? 'static' : 'entering'} />;
    }
    let tree: any;
    try {
      await act(async () => {
        tree = create(
          <>
            <Entrance />
            <Sheet visible title="Report" onClose={() => {}}>
              <Text>Report reasons</Text>
            </Sheet>
          </>,
        );
      });
      expect(first[0]).toBe(reduced);
      expect(tree.root.findByType(Modal).props.animationType).toBe(reduced ? 'none' : 'slide');
      expect(first).toEqual([reduced]);
    } finally {
      if (tree) await act(async () => tree.unmount());
      query.mockRestore();
    }
  },
);

test.each([false, true])(
  'toast chooses its first entrance before async preference resolution, Reduce Motion=%s',
  async (reduced) => {
    jest.useFakeTimers();
    mockInitial = reduced;
    jest.mocked(withSpring).mockClear();
    jest.mocked(withTiming).mockClear();
    jest.mocked(cancelAnimation).mockClear();
    const query = jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockReturnValue(new Promise(() => {}));
    let tree: any;
    try {
      await act(async () => {
        tree = create(<ActivityToast toast={{ id: 1, emoji: '✓', text: 'Ready' }} />);
      });
      if (reduced) {
        expect(withSpring).not.toHaveBeenCalled();
        expect(withTiming).not.toHaveBeenCalled();
      } else {
        expect(withSpring).toHaveBeenCalledWith(0, expect.anything());
        expect(withTiming).toHaveBeenCalledWith(1, { duration: 180 });
      }
      await act(async () => tree.unmount());
      tree = null;
      expect(cancelAnimation).toHaveBeenCalledTimes(2);
      const calls = jest.mocked(withTiming).mock.calls.length;
      await act(async () => jest.advanceTimersByTime(3000));
      expect(withTiming).toHaveBeenCalledTimes(calls);
    } finally {
      if (tree) await act(async () => tree.unmount());
      query.mockRestore();
      jest.useRealTimers();
    }
  },
);
