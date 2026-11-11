import React from 'react';
import {
  AccessibilityInfo,
  Keyboard,
  Platform,
  ScrollView,
  Switch,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import CreatePickScreen from '../../app/pick/new';
import { Button, Chips, ErrorState } from '@/components';
import { MapPicker } from '@/components/MapPicker';
import { LocationSearch } from '@/components/LocationSearch';
import { CustomPlanEditor } from '@/components/CustomPlanEditor';
import { api } from '@/lib/api';
import { DEFAULT_POOL_SIZE, milesToMeters } from '@shared/domain/createPick.ts';

const { create, act } = jest.requireActual('react-test-renderer');
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  router: { canGoBack: jest.fn(), back: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('react-native/Libraries/Components/View/View', () => {
  const React = jest.requireActual('react');
  return {
    __esModule: true,
    default: React.forwardRef(function MockView(props: object, ref: unknown) {
      React.useImperativeHandle(ref, () => ({
        measureLayout: mockMeasureLayout,
        focus: mockFocus,
      }));
      return React.createElement('View', props);
    }),
  };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/lib/haptics', () => ({
  haptic: { tap: jest.fn(), tick: jest.fn(), success: jest.fn() },
}));
jest.mock('@/lib/api', () => ({
  api: { createPick: jest.fn(), createGroupPick: jest.fn(), hangPick: jest.fn() },
}));
jest.mock('@/lib/locationSearch', () => ({ DEFAULT_CENTER: { lat: 40.915, lng: -73.123 } }));
jest.mock('@/components/MapPicker', () => ({ MapPicker: () => null }));
jest.mock('@/components/LocationSearch', () => ({ LocationSearch: () => null }));
jest.mock('@/components/CustomPlanEditor', () => ({ CustomPlanEditor: () => null }));
jest.mock('@react-native-community/slider', () => 'test-slider');

let tree: any;
const mockFocus = jest.fn();
const mockInnerRef = { nativeComponent: true };
// Match Fabric's contract: numeric handles (even legacy typings allow them) fail.
const measureNative = (
  relative: unknown,
  success: (...args: number[]) => void,
  _onFail?: () => void,
) => {
  if (relative !== mockInnerRef) throw new Error('Expected the ScrollView native component ref');
  success(0, 500, 300, 60);
};
const mockMeasureLayout = jest.fn(measureNative);
const button = (label: string) =>
  tree.root.findAllByType(Button).find((n: any) => n.props.label === label);
const chips = (label: string) =>
  tree.root.findAllByType(Chips).find((n: any) => n.props.accessibilityLabel === label);
const press = async (label: string) =>
  act(async () => {
    tree.root
      .findAllByProps({ accessibilityLabel: label })
      .find((n: any) => typeof n.props.onPress === 'function')
      .props.onPress();
  });
beforeEach(async () => {
  jest.clearAllMocks();
  mockMeasureLayout.mockReset().mockImplementation(measureNative);
  // The preset's ScrollView methods are no-op mocks. Make their distinct runtime
  // contracts explicit rather than allowing undefined/numeric measurements.
  jest.spyOn(ScrollView.prototype, 'getInnerViewNode').mockImplementation(() => {
    throw new Error('Numeric ScrollView handles must not be used for measurement');
  });
  jest
    .spyOn(ScrollView.prototype as ScrollView & { getInnerViewRef(): unknown }, 'getInnerViewRef')
    .mockReturnValue(mockInnerRef);
  mockParams = {};
  jest.mocked(api.createPick).mockResolvedValue({ pickId: 'pick' } as any);
  jest.mocked(api.createGroupPick).mockResolvedValue({ pickId: 'pick' } as any);
  jest.mocked(api.hangPick).mockResolvedValue({ pickId: 'pick', isParticipant: true } as any);
});
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
  jest.restoreAllMocks();
});
const render = async () =>
  act(async () => {
    tree = create(<CreatePickScreen />, {
      createNodeMock: () => ({ measureLayout: mockMeasureLayout }),
    });
  });

test('defaults create without opening secondary settings; footer is outside scrolling content', async () => {
  const now = Date.now();
  jest.spyOn(Date, 'now').mockReturnValue(now);
  await render();
  expect(chips('Deadline')).toBeUndefined();
  expect(tree.root.findByType(ScrollView).findAllByType(Button)).toHaveLength(0);
  await act(async () => button('Create Pick').props.onPress());
  expect(api.createPick).toHaveBeenCalledWith(
    expect.objectContaining({
      category: 'food',
      radiusM: milesToMeters(2),
      priceMax: null,
      openNow: false,
      poolSize: DEFAULT_POOL_SIZE,
      includeSaved: false,
      closeThreshold: 100,
      deadlineAt: new Date(now + 60 * 60_000).toISOString(),
    }),
  );
  expect(router.replace).toHaveBeenCalledWith({
    pathname: '/pick/[id]/lobby',
    params: { id: 'pick' },
  });
});

test.each(['food', 'activities', 'both', 'custom'])(
  '%s mode retains its payload',
  async (category) => {
    await render();
    await act(async () => chips('Category').props.onChange(category));
    if (category === 'custom') {
      await act(async () =>
        tree.root
          .findByType(CustomPlanEditor)
          .props.onChange([{ name: 'Chess' }, { name: 'Cards' }]),
      );
    }
    await act(async () => button('Create Pick').props.onPress());
    expect(api.createPick).toHaveBeenCalledWith(
      expect.objectContaining({
        category,
        ...(category === 'custom'
          ? { poolSize: 2, customOptions: [{ name: 'Chess' }, { name: 'Cards' }] }
          : {}),
      }),
    );
  },
);

test('settings survive collapse and mode changes and reach the payload', async () => {
  await render();
  await press('More options');
  await act(async () => {
    chips('Deadline').props.onChange(0);
    chips('Pool size').props.onChange(30);
    chips('Close threshold').props.onChange(75);
    tree.root.findByType('test-slider').props.onValueChange(4);
    tree.root
      .findAllByType(Switch)
      .find((n: any) => n.props.accessibilityLabel === 'Include my saved places inside the radius')
      .props.onValueChange(true);
    chips('Maximum price').props.onChange(2);
    tree.root
      .findAllByType(Switch)
      .find((n: any) => n.props.accessibilityLabel === 'Only places known to be open now')
      .props.onValueChange(true);
  });
  await press('More options');
  await act(async () => chips('Category').props.onChange('custom'));
  await act(async () => chips('Category').props.onChange('both'));
  await press('More options');
  expect(chips('Deadline').props.value).toBe(0);
  await act(async () => button('Create Pick').props.onPress());
  expect(api.createPick).toHaveBeenCalledWith(
    expect.objectContaining({
      category: 'both',
      radiusM: milesToMeters(4),
      priceMax: 2,
      openNow: true,
      includeSaved: true,
      poolSize: 30,
      deadlineAt: null,
      closeThreshold: 75,
    }),
  );
});

test('map toggle calls keyboard dismissal; location and pin callbacks reach creation', async () => {
  await render();
  const dismiss = jest.spyOn(Keyboard, 'dismiss');
  await press('Expand map');
  expect(dismiss).toHaveBeenCalled();
  expect(tree.root.findByType(MapPicker).props.height).toBe(320);
  await act(async () =>
    tree.root.findByType(LocationSearch).props.onPick({ lat: 41, lng: -73 }, 'Town'),
  );
  expect(tree.root.findByType(MapPicker).props.center).toEqual({ lat: 41, lng: -73 });
  await act(async () =>
    tree.root.findByType(MapPicker).props.onChangeCenter({ lat: 42, lng: -72 }),
  );
  await press('Collapse map');
  await act(async () => button('Create Pick').props.onPress());
  expect(api.createPick).toHaveBeenCalledWith(
    expect.objectContaining({ center: { lat: 42, lng: -72 } }),
  );
  dismiss.mockRestore();
});

test('group ideas and custom mixing preserve pool semantics', async () => {
  mockParams = { groupId: 'group', groupName: 'Crew' };
  await render();
  await act(async () => chips('Category').props.onChange('custom'));
  await act(async () => {
    tree.root.findByType(CustomPlanEditor).props.onChange([{ name: 'Chess' }, { name: 'Cards' }]);
    chips('Mix nearby places').props.onChange('food');
  });
  await press('More options');
  await act(async () =>
    tree.root
      .findAllByType(Switch)
      .find((n: any) => n.props.accessibilityLabel === 'Include Group Ideas')
      .props.onValueChange(true),
  );
  await act(async () => button('Create Pick').props.onPress());
  expect(api.createGroupPick).toHaveBeenCalledWith(
    expect.objectContaining({
      groupId: 'group',
      includeGroupIdeas: true,
      category: 'custom',
      mixCategory: 'food',
      poolSize: 30,
    }),
    'group',
  );
});

test('hang creates through existing endpoint and preserves nonparticipant completion', async () => {
  mockParams = { hangId: 'hang' };
  jest.mocked(api.hangPick).mockResolvedValue({ pickId: 'pick', isParticipant: false } as any);
  await render();
  await act(async () => button('Create Pick').props.onPress());
  expect(api.hangPick).toHaveBeenCalledWith(
    'hang',
    expect.objectContaining({ category: 'activities' }),
  );
  expect(JSON.stringify(tree.toJSON())).toContain('Their host can start it.');
});

test('duplicate taps send once; failed requests preserve settings and allow retry', async () => {
  const now = Date.now();
  const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
  let reject!: (e: Error) => void;
  jest.mocked(api.createPick).mockReturnValueOnce(
    new Promise((_, r) => {
      reject = r;
    }),
  );
  await render();
  await press('More options');
  await act(async () => {
    chips('Pool size').props.onChange(30);
    chips('Maximum price').props.onChange(2);
  });
  await press('More options');
  await act(async () => {
    button('Create Pick').props.onPress();
    button('Create Pick').props.onPress();
  });
  expect(api.createPick).toHaveBeenCalledTimes(1);
  await act(async () => reject(new Error('Offline')));
  expect(JSON.stringify(tree.toJSON())).toContain('Offline');
  clock.mockReturnValue(now + 15_000);
  await act(async () => button('Create Pick').props.onPress());
  expect(api.createPick).toHaveBeenCalledTimes(2);
  const [original] = jest.mocked(api.createPick).mock.calls[0]!;
  const [retry] = jest.mocked(api.createPick).mock.calls[1]!;
  expect(retry).toEqual({
    ...original,
    // Relative deadlines intentionally start again at the retry tap.
    deadlineAt: new Date(now + 15_000 + 60 * 60_000).toISOString(),
  });
  expect(retry).toMatchObject({ poolSize: 30, priceMax: 2 });
});

test('invalid custom options are announced without a network request', async () => {
  await render();
  await act(async () => chips('Category').props.onChange('custom'));
  await act(async () => button('Create Pick').props.onPress());
  expect(api.createPick).not.toHaveBeenCalled();
  expect(tree.root.findAllByProps({ accessibilityRole: 'alert' }).length).toBeGreaterThan(0);
});

test('hidden validation errors open More options instead of hiding the failure', async () => {
  await render();
  await press('More options');
  await act(async () => chips('Pool size').props.onChange(99));
  await press('More options');
  await act(async () => button('Create Pick').props.onPress());
  expect(api.createPick).not.toHaveBeenCalled();
  expect(chips('Pool size')).toBeDefined();
  expect(tree.root.findAllByProps({ accessibilityRole: 'alert' }).length).toBeGreaterThan(0);
});

test('custom mixing uses the existing twenty-place minimum without Group Ideas', async () => {
  await render();
  await act(async () => chips('Category').props.onChange('custom'));
  await act(async () => {
    tree.root.findByType(CustomPlanEditor).props.onChange([{ name: 'Chess' }, { name: 'Cards' }]);
    chips('Mix nearby places').props.onChange('activities');
  });
  await act(async () => button('Create Pick').props.onPress());
  expect(api.createPick).toHaveBeenCalledWith(
    expect.objectContaining({
      poolSize: 20,
      mixCategory: 'activities',
    }),
  );
});

test('submission error and retry are scrollable; footer contains only Create Pick', async () => {
  jest.replaceProperty(Platform, 'OS', 'ios');
  const scrollTo = jest.spyOn(ScrollView.prototype, 'scrollTo').mockImplementation(() => {});
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
  jest.mocked(api.createPick).mockRejectedValueOnce(new Error('Offline'));
  await render();
  await act(async () => button('Create Pick').props.onPress());
  const scroll = tree.root.findByType(ScrollView);
  const error = scroll.findByType(ErrorState);
  expect(error.props.message).toBe('Offline');
  expect(error.findAllByType(Button).map((n: any) => n.props.label)).toEqual(['Try again']);
  const footer = button('Create Pick').parent;
  expect(footer.findAllByType(ErrorState)).toHaveLength(0);
  expect(footer.findAllByType(Button).map((n: any) => n.props.label)).toEqual(['Create Pick']);
  await act(async () => error.parent.props.onLayout());
  expect(mockMeasureLayout).toHaveBeenCalledWith(
    mockInnerRef,
    expect.any(Function),
    expect.any(Function),
  );
  expect(scrollTo).toHaveBeenCalledWith({ y: 488, animated: false });
  expect(announce).toHaveBeenCalledWith('Offline');
  await act(async () => error.parent.props.onLayout());
  expect(scrollTo).toHaveBeenCalledTimes(1);
  expect(announce).toHaveBeenCalledTimes(1);
  await act(async () => error.props.onRetry());
  expect(api.createPick).toHaveBeenCalledTimes(2);
});

test('More options exposes changed settings once through its accessibility value', async () => {
  await render();
  const disclosure = () =>
    tree.root
      .findAllByProps({ accessibilityLabel: 'More options' })
      .find((n: any) => typeof n.props.onPress === 'function');
  expect(disclosure().props.accessibilityValue).toBeUndefined();
  await press('More options');
  await act(async () => chips('Pool size').props.onChange(30));
  await press('More options');
  expect(disclosure().props.accessibilityLabel).toBe('More options');
  expect(disclosure().props.accessibilityValue).toEqual({ text: '30 places' });
  expect(disclosure().props.accessibilityState).toEqual({ expanded: false });
});

test.each(['ios', 'android', 'web'] as const)(
  '%s retains its compact and expanded map heights',
  async (platform) => {
    jest.replaceProperty(Platform, 'OS', platform);
    await render();
    expect(tree.root.findByType(MapPicker).props.height).toBe(platform === 'web' ? 240 : 144);
    await press('Expand map');
    expect(tree.root.findByType(MapPicker).props.height).toBe(320);
    await press('Collapse map');
    expect(tree.root.findByType(MapPicker).props.height).toBe(platform === 'web' ? 240 : 144);
  },
);

test('No deadline is exposed in the collapsed summary and accessible value', async () => {
  await render();
  await press('More options');
  await act(async () => chips('Deadline').props.onChange(0));
  await press('More options');
  const control = tree.root
    .findAllByProps({ accessibilityLabel: 'More options' })
    .find((n: any) => typeof n.props.onPress === 'function');
  expect(control.props.accessibilityValue).toEqual({ text: 'No deadline' });
  expect(JSON.stringify(control.toJSON?.() ?? tree.toJSON())).toContain('No deadline');
});

test('Custom validation reveals and focuses the first invalid field after its layout', async () => {
  const scroll = jest.spyOn(ScrollView.prototype, 'scrollTo').mockImplementation(() => {});
  const focus = jest
    .spyOn(AccessibilityInfo, 'sendAccessibilityEvent')
    .mockImplementation(() => {});
  await render();
  await act(async () => chips('Category').props.onChange('custom'));
  await act(async () => button('Create Pick').props.onPress());
  expect(scroll).not.toHaveBeenCalled();
  const problem = tree.root
    .findAllByType(View)
    .find(
      (n: any) =>
        n.props.accessibilityLabel === 'Your options. Option names must be 1–60 characters.' &&
        typeof n.props.onLayout === 'function',
    );
  expect(problem).toBeDefined();
  await act(async () => problem.props.onLayout());
  expect(scroll).toHaveBeenCalledWith({ y: 488, animated: false });
  expect(focus).toHaveBeenCalledWith(
    expect.objectContaining({ measureLayout: mockMeasureLayout }),
    'focus',
  );
  await act(async () => problem.props.onLayout());
  expect(scroll).toHaveBeenCalledTimes(1);
});

test('first hidden validation error expands options and reveals only that field', async () => {
  const scroll = jest.spyOn(ScrollView.prototype, 'scrollTo').mockImplementation(() => {});
  const focus = jest
    .spyOn(AccessibilityInfo, 'sendAccessibilityEvent')
    .mockImplementation(() => {});
  await render();
  await press('More options');
  await act(async () => {
    chips('Pool size').props.onChange(99);
    chips('Close threshold').props.onChange(0);
  });
  await press('More options');
  await act(async () => button('Create Pick').props.onPress());
  const errors = tree.root
    .findAllByType(View)
    .filter(
      (n: any) =>
        typeof n.props.onLayout === 'function' &&
        n.props.accessibilityLabel?.includes('must be between'),
    );
  expect(errors).toHaveLength(2);
  const first = errors.find((n: any) => n.props.accessibilityLabel.startsWith('How many places.'));
  await act(async () => first.props.onLayout());
  expect(focus).toHaveBeenCalledTimes(1);
  await act(async () =>
    errors.filter((n: any) => n !== first).forEach((n: any) => n.props.onLayout()),
  );
  expect(focus).toHaveBeenCalledTimes(1);
  expect(scroll).toHaveBeenCalledTimes(1);
  expect(chips('Pool size')).toBeDefined();
});

test('identical submission failures reveal once per attempt without content-size events', async () => {
  const scroll = jest.spyOn(ScrollView.prototype, 'scrollTo').mockImplementation(() => {});
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
  jest.mocked(api.createPick).mockRejectedValue(new Error('Offline'));
  await render();
  for (let i = 0; i < 2; i++) {
    await act(async () => button('Create Pick').props.onPress());
    const error = tree.root.findByType(ErrorState);
    await act(async () => error.parent.props.onLayout());
    await act(async () => error.parent.props.onLayout());
  }
  expect(scroll).toHaveBeenCalledTimes(2);
  await press('Expand map');
  expect(scroll).toHaveBeenCalledTimes(2);
});

test('superseded error measurements cannot cause a late scroll', async () => {
  const scroll = jest.spyOn(ScrollView.prototype, 'scrollTo').mockImplementation(() => {});
  let complete!: (...args: number[]) => void;
  mockMeasureLayout.mockImplementationOnce((_relative, success) => {
    complete = success;
  });
  jest.mocked(api.createPick).mockRejectedValueOnce(new Error('Offline'));
  await render();
  await act(async () => button('Create Pick').props.onPress());
  await act(async () => tree.root.findByType(ErrorState).parent.props.onLayout());
  await act(async () => button('Create Pick').props.onPress());
  await act(async () => complete(0, 500, 300, 60));
  expect(scroll).not.toHaveBeenCalled();
});

test('web validation focuses its anchor without calling the native-only accessibility API', async () => {
  jest.replaceProperty(Platform, 'OS', 'web');
  jest.spyOn(ScrollView.prototype, 'scrollTo').mockImplementation(() => {});
  const nativeFocus = jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent');
  await render();
  await act(async () => chips('Category').props.onChange('custom'));
  await act(async () => button('Create Pick').props.onPress());
  const problem = tree.root
    .findAllByType(View)
    .find((n: any) => n.props.accessibilityLabel?.startsWith('Your options.') && n.props.onLayout);
  expect(problem.props.tabIndex).toBe(-1);
  await act(async () => problem.props.onLayout());
  expect(mockFocus).toHaveBeenCalledTimes(1);
  expect(nativeFocus).not.toHaveBeenCalled();
});

test('the measurement fixture rejects numeric handles instead of hiding the device failure', () => {
  expect(() => mockMeasureLayout(42, jest.fn())).toThrow('native component ref');
});

test.each(['ios', 'android'] as const)(
  '%s validation exposes one accessible alert with its label and readable text',
  async (platform) => {
    jest.replaceProperty(Platform, 'OS', platform);
    jest.spyOn(ScrollView.prototype, 'scrollTo').mockImplementation(() => {});
    const focus = jest
      .spyOn(AccessibilityInfo, 'sendAccessibilityEvent')
      .mockImplementation(() => {});
    await render();
    await act(async () => chips('Category').props.onChange('custom'));
    await act(async () => button('Create Pick').props.onPress());
    const alert = tree.root
      .findAllByType(View)
      .find(
        (n: any) =>
          n.props.accessibilityLabel === 'Your options. Option names must be 1–60 characters.',
      );
    expect(alert.props).toMatchObject({
      accessible: true,
      accessibilityRole: 'alert',
      accessibilityLiveRegion: 'polite',
    });
    const text = alert.findByType(Text);
    expect(text.props.accessible).toBe(false);
    expect(text.props.accessibilityRole).toBeUndefined();
    expect(text.props.children).toBe('Option names must be 1–60 characters.');
    await act(async () => alert.props.onLayout());
    expect(focus).toHaveBeenCalledTimes(1);
    expect(mockMeasureLayout.mock.calls[0]![0]).toBe(mockInnerRef);
  },
);

test('missing inner ref announces once without scheduling an unexpected later scroll', async () => {
  const inner = jest.mocked(
    (ScrollView.prototype as ScrollView & { getInnerViewRef(): unknown }).getInnerViewRef,
  );
  inner.mockReturnValue(null);
  const scroll = jest.spyOn(ScrollView.prototype, 'scrollTo').mockImplementation(() => {});
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
  await render();
  await act(async () => chips('Category').props.onChange('custom'));
  await act(async () => button('Create Pick').props.onPress());
  const alert = () =>
    tree.root
      .findAllByType(View)
      .find((n: any) => n.props.accessibilityLabel?.startsWith('Your options.'));
  await act(async () => alert().props.onLayout());
  expect(mockMeasureLayout).not.toHaveBeenCalled();
  expect(announce).toHaveBeenCalledWith('Your options. Option names must be 1–60 characters.');
  inner.mockReturnValue(mockInnerRef);
  await act(async () => alert().props.onLayout());
  expect(scroll).not.toHaveBeenCalled();
  await act(async () => button('Create Pick').props.onPress());
  await act(async () => alert().props.onLayout());
  expect(scroll).toHaveBeenCalledTimes(1);
});

test('failed measurement announces once and a late failure after unmount stays silent', async () => {
  let fail!: () => void;
  let succeed!: (...args: number[]) => void;
  mockMeasureLayout.mockImplementationOnce((_relative, _success, onFail?: () => void) => {
    fail = onFail!;
    succeed = _success;
  });
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
  const scroll = jest.spyOn(ScrollView.prototype, 'scrollTo').mockImplementation(() => {});
  await render();
  await act(async () => chips('Category').props.onChange('custom'));
  await act(async () => button('Create Pick').props.onPress());
  const alert = tree.root
    .findAllByType(View)
    .find((n: any) => n.props.accessibilityLabel?.startsWith('Your options.'));
  await act(async () => alert.props.onLayout());
  await act(async () => fail());
  expect(announce).toHaveBeenCalledTimes(1);
  expect(scroll).not.toHaveBeenCalled();
  await act(async () => {
    fail();
    succeed(0, 500, 300, 60);
  });
  expect(scroll).not.toHaveBeenCalled();
  expect(announce).toHaveBeenCalledTimes(1);
  await act(async () => tree.unmount());
  tree = null;
  await act(async () => fail());
  expect(announce).toHaveBeenCalledTimes(1);
});
