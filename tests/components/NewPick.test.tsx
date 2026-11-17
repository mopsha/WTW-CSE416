import { EMPTY_PREFERENCES, type Preferences } from '@shared/domain/preferences.ts';
import { PlanTimeSheet } from '@/components/PlanTimeSheet';
import React from 'react';
import {
  AccessibilityInfo,
  AppState,
  Keyboard,
  Modal,
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
import { CategoryCards, ChoiceList, SettingRow } from '@/components/NewPickControls';
import { Sheet } from '@/components/TabUi';
import { api } from '@/lib/api';
import { DEFAULT_POOL_SIZE, milesToMeters } from '@shared/domain/createPick.ts';

const { create, act } = jest.requireActual('react-test-renderer');
let mockAccount = 'owner';
let mockPreferences: Preferences = EMPTY_PREFERENCES;
let mockProfileLoading = false;
jest.mock('@/hooks/useProfile', () => ({
  useProfile: () => ({ preferences: mockPreferences, loading: mockProfileLoading }),
}));
let mockReducedMotion = false;
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => mockReducedMotion }));
jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ session: { user: { id: mockAccount } } }),
}));
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
  api: {
    getPickCapabilities: jest.fn(),
    createPick: jest.fn(),
    createGroupPick: jest.fn(),
    hangPick: jest.fn(),
  },
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
  label === 'Category'
    ? tree.root.findByType(CategoryCards)
    : tree.root.findAllByType(Chips).find((n: any) => n.props.accessibilityLabel === label);
const press = async (label: string) =>
  act(async () => {
    tree.root
      .findAllByProps({ accessibilityLabel: label })
      .find((n: any) => typeof n.props.onPress === 'function')
      .props.onPress();
  });
beforeEach(async () => {
  jest.clearAllMocks();
  mockPreferences = EMPTY_PREFERENCES;
  mockProfileLoading = false;
  jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
  jest
    .mocked(api.getPickCapabilities)
    .mockResolvedValue({ availabilityFirst: true, availabilityMode: 'immediate' });
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
  mockAccount = 'owner';
  mockReducedMotion = false;
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

const choose = async (row: string, value: number) => {
  await press(row);
  await act(async () => tree.root.findByType(ChoiceList).props.onChange(value));
};
const changeSwitch = async (label: string, value = true) =>
  act(async () => {
    tree.root
      .findAllByType(Switch)
      .find((n: any) => n.props.accessibilityLabel === label)
      .props.onValueChange(value);
  });
const row = (label: string) =>
  tree.root.findAllByType(SettingRow).find((n: any) => n.props.label === label);

test('defaults create without editors; footer remains outside scrolling content', async () => {
  const now = Date.now();
  jest.spyOn(Date, 'now').mockReturnValue(now);
  await render();
  expect(tree.root.findAllByType(MapPicker)).toHaveLength(0);
  expect(tree.root.findAllByType(Sheet)).toHaveLength(0);
  expect(tree.root.findByType(ScrollView).findAllByType(Button)).toHaveLength(0);
  expect(row('Where').props.value).toBe('SBU Academic Mall · 2 mi');
  expect(row('Number of places').props.value).toBe('20');
  expect(row('Close early').props.value).toBe('Everyone finishes swiping');
  expect(row("Who's joining?").props.onPress).toBeUndefined();
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
  '%s category exposes selection and preserves payload',
  async (category) => {
    await render();
    await act(async () => chips('Category').props.onChange(category));
    const radios = tree.root
      .findByType(CategoryCards)
      .findAllByProps({ accessibilityRole: 'radio' })
      .filter((n: any) => n.props.onPress);
    expect(radios.filter((n: any) => n.props.accessibilityState.selected)).toHaveLength(1);
    if (category === 'custom') {
      expect(row('Where')).toBeUndefined();
      expect(row('Place filters')).toBeUndefined();
      expect(row('Number of places')).toBeUndefined();
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
test('settings persist across editors and categories with accurate summaries', async () => {
  await render();
  await choose('Swipe deadline', 0);
  await choose('Number of places', 30);
  await choose('Close early', 75);
  await changeSwitch('Include my saved places inside the radius');
  await press('Place filters');
  await act(async () => chips('Maximum price').props.onChange(2));
  await changeSwitch('Only places known to be open now');
  await act(async () => button('Apply filters').props.onPress());
  await act(async () => chips('Category').props.onChange('custom'));
  await act(async () => chips('Category').props.onChange('both'));
  expect(row('Swipe deadline').props.value).toBe('No deadline');
  expect(row('Place filters').props.value).toBe('$$ · Open now');
  expect(row('Close early').props.value).toBe('75% finish swiping');
  await act(async () => button('Create Pick').props.onPress());
  expect(api.createPick).toHaveBeenCalledWith(
    expect.objectContaining({
      category: 'both',
      priceMax: 2,
      openNow: true,
      includeSaved: true,
      poolSize: 30,
      deadlineAt: null,
      closeThreshold: 75,
    }),
  );
});
test('filter confirmation commits while closing cancels drafts', async () => {
  await render();
  await press('Place filters');
  await act(async () => chips('Maximum price').props.onChange(0));
  await act(async () => tree.root.findByType(Sheet).props.onClose());
  expect(row('Place filters').props.value).toBe('Any price');
  await press('Place filters');
  expect(chips('Maximum price').props.value).toBe(-1);
  await act(async () => chips('Maximum price').props.onChange(4));
  await act(async () => button('Apply filters').props.onPress());
  expect(row('Place filters').props.value).toBe('$$$$');
});
test('location drafts support search, pin, radius, expand, confirm, cancel and reopen', async () => {
  await render();
  const dismiss = jest.spyOn(Keyboard, 'dismiss');
  await press('Where');
  expect(tree.root.findByType(MapPicker).props.center).toEqual({ lat: 40.915, lng: -73.123 });
  await act(async () =>
    tree.root.findByType(LocationSearch).props.onPick({ lat: 41, lng: -73 }, 'Town'),
  );
  await press('Expand map');
  expect(dismiss).toHaveBeenCalled();
  const expandedHeight = tree.root.findByType(MapPicker).props.height;
  await press('Collapse map');
  expect(tree.root.findByType(MapPicker).props.height).toBeLessThan(expandedHeight);
  await act(async () => {
    tree.root.findByType(MapPicker).props.onChangeCenter({ lat: 42, lng: -72 });
    tree.root.findByType('test-slider').props.onValueChange(4);
  });
  expect(tree.root.findByType(LocationSearch).props.label).toBe('Dropped pin');
  await act(async () => button('Use this location').props.onPress());
  expect(row('Where').props.value).toBe('Dropped pin · 4 mi');
  await press('Where');
  expect(tree.root.findByType(MapPicker).props.center).toEqual({ lat: 42, lng: -72 });
  await act(async () => tree.root.findByType('test-slider').props.onValueChange(8));
  await act(async () => button('Cancel').props.onPress());
  await press('Where');
  expect(tree.root.findByType('test-slider').props.value).toBe(4);
  await act(async () => tree.root.findByType(Modal).props.onRequestClose());
  expect(row('Where').props.value).toBe('Dropped pin · 4 mi');
  await act(async () => button('Create Pick').props.onPress());
  expect(api.createPick).toHaveBeenCalledWith(
    expect.objectContaining({ center: { lat: 42, lng: -72 }, radiusM: milesToMeters(4) }),
  );
});
test('group ideas and custom mixing preserve pool semantics and category state', async () => {
  mockParams = { groupId: 'group', groupName: 'Crew' };
  await render();
  expect(row("Who's joining?").props.value).toContain('Crew');
  await act(async () => chips('Category').props.onChange('custom'));
  await act(async () => {
    tree.root.findByType(CustomPlanEditor).props.onChange([{ name: 'Chess' }, { name: 'Cards' }]);
    chips('Mix nearby places').props.onChange('food');
  });
  expect(row('Where')).toBeDefined();
  await changeSwitch('Include Group Ideas');
  await act(async () => chips('Category').props.onChange('food'));
  await act(async () => chips('Category').props.onChange('custom'));
  expect(tree.root.findByType(CustomPlanEditor).props.options).toEqual([
    { name: 'Chess' },
    { name: 'Cards' },
  ]);
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
test('custom mixing retains twenty-place minimum without Group Ideas', async () => {
  await render();
  await act(async () => chips('Category').props.onChange('custom'));
  await act(async () => {
    tree.root.findByType(CustomPlanEditor).props.onChange([{ name: 'Chess' }, { name: 'Cards' }]);
    chips('Mix nearby places').props.onChange('activities');
  });
  await act(async () => button('Create Pick').props.onPress());
  expect(api.createPick).toHaveBeenCalledWith(
    expect.objectContaining({ poolSize: 20, mixCategory: 'activities' }),
  );
});
test('Hang endpoint preserves prefill, host saved-place label and nonparticipant completion', async () => {
  mockParams = { hangId: 'hang', hangActivity: 'Basketball', groupId: 'ignored' };
  jest.mocked(api.hangPick).mockResolvedValue({ pickId: 'draft', isParticipant: false } as any);
  await render();
  expect(chips('Category').props.value).toBe('activities');
  expect(JSON.stringify(tree.toJSON())).toContain('Basketball');
  expect(
    tree.root
      .findAllByType(Switch)
      .some((n: any) => n.props.accessibilityLabel === 'Include Group Ideas'),
  ).toBe(false);
  await act(async () => button('Create Pick').props.onPress());
  expect(api.hangPick).toHaveBeenCalledWith(
    'hang',
    expect.objectContaining({ category: 'activities' }),
  );
  expect(jest.mocked(api.hangPick).mock.calls[0]![1]).not.toHaveProperty('groupId');
  expect(JSON.stringify(tree.toJSON())).toContain('Their host can start it.');
});
test('duplicate taps send once; pending controls lock; retry preserves values and resets relative deadline', async () => {
  const now = Date.now();
  const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
  let reject!: (e: Error) => void;
  jest.mocked(api.createPick).mockReturnValueOnce(
    new Promise((_, r) => {
      reject = r;
    }),
  );
  await render();
  await choose('Number of places', 30);
  await act(async () => {
    button('Create Pick').props.onPress();
    button('Create Pick').props.onPress();
  });
  expect(api.createPick).toHaveBeenCalledTimes(1);
  expect(chips('Category').props.disabled).toBe(true);
  expect(row('Where').props.disabled).toBe(true);
  await act(async () => reject(new Error('Offline')));
  expect(JSON.stringify(tree.toJSON())).toContain('Offline');
  clock.mockReturnValue(now + 15000);
  await act(async () => button('Create Pick').props.onPress());
  const [original] = jest.mocked(api.createPick).mock.calls[0]!;
  expect(api.createPick).toHaveBeenLastCalledWith({
    ...original,
    deadlineAt: new Date(now + 15000 + 60 * 60000).toISOString(),
  });
});
test('account and creation-context changes discard private drafts and silence old creation responses', async () => {
  let finish!: (value: any) => void;
  jest.mocked(api.createPick).mockReturnValueOnce(
    new Promise((r) => {
      finish = r;
    }),
  );
  await render();
  await changeSwitch('Include my saved places inside the radius');
  await act(async () => button('Create Pick').props.onPress());
  mockAccount = 'other';
  await act(async () => tree.update(<CreatePickScreen />));
  expect(chips('Category').props.disabled).toBe(false);
  await act(async () => finish({ pickId: 'old-account' }));
  expect(router.replace).not.toHaveBeenCalled();
  await press('Where');
  await act(async () => tree.root.findByType('test-slider').props.onValueChange(7));
  mockParams = { groupId: 'new-group' };
  await act(async () => tree.update(<CreatePickScreen />));
  expect(tree.root.findAllByType(MapPicker)).toHaveLength(0);
  expect(row('Where').props.value).toBe('SBU Academic Mall · 2 mi');
});
test('unmounted form ignores late mutation success', async () => {
  let finish!: (value: any) => void;
  jest.mocked(api.createPick).mockReturnValueOnce(
    new Promise((r) => {
      finish = r;
    }),
  );
  await render();
  await act(async () => button('Create Pick').props.onPress());
  await act(async () => tree.unmount());
  tree = null;
  await act(async () => finish({ pickId: 'late' }));
  expect(router.replace).not.toHaveBeenCalled();
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

test('grouped validation errors reveal only the first invalid field', async () => {
  const scroll = jest.spyOn(ScrollView.prototype, 'scrollTo').mockImplementation(() => {});
  const focus = jest
    .spyOn(AccessibilityInfo, 'sendAccessibilityEvent')
    .mockImplementation(() => {});
  await render();
  await choose('Number of places', 99);
  await choose('Close early', 0);
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
  await act(async () =>
    errors.filter((n: any) => n !== first).forEach((n: any) => n.props.onLayout()),
  );
  expect(focus).toHaveBeenCalledTimes(1);
  expect(scroll).toHaveBeenCalledTimes(1);
  expect(row('Number of places')).toBeDefined();
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
  await press('Where');
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

test('invalid custom counts and names never create; duplicate labels preserve existing behavior', async () => {
  await render();
  await act(async () => chips('Category').props.onChange('custom'));
  for (const options of [
    [{ name: 'Only one' }],
    Array.from({ length: 21 }, (_, i) => ({ name: `Idea ${i}` })),
    [{ name: ' ' }, { name: 'Cards' }],
  ]) {
    await act(async () => tree.root.findByType(CustomPlanEditor).props.onChange(options));
    await act(async () => button('Create Pick').props.onPress());
    expect(api.createPick).not.toHaveBeenCalled();
  }
  // Existing validation permits repeated labels; candidate identity deduplication is unchanged.
  await act(async () =>
    tree.root.findByType(CustomPlanEditor).props.onChange([{ name: 'Chess' }, { name: 'Chess' }]),
  );
  await act(async () => button('Create Pick').props.onPress());
  expect(api.createPick).toHaveBeenCalledWith(
    expect.objectContaining({ customOptions: [{ name: 'Chess' }, { name: 'Chess' }] }),
  );
  expect(router.replace).toHaveBeenCalledWith({
    pathname: '/pick/[id]/lobby',
    params: { id: 'pick' },
  });
});

test('an existing Hang draft response navigates through the same lobby contract', async () => {
  mockParams = { hangId: 'converted-hang' };
  jest
    .mocked(api.hangPick)
    .mockResolvedValue({ pickId: 'existing-draft', isParticipant: true } as any);
  await render();
  await act(async () => button('Create Pick').props.onPress());
  expect(router.replace).toHaveBeenCalledWith({
    pathname: '/pick/[id]/lobby',
    params: { id: 'existing-draft' },
  });
});

test('large text and long names stay readable; location editor respects reduced motion', async () => {
  jest
    .spyOn(jest.requireActual('react-native'), 'useWindowDimensions')
    .mockReturnValue({ width: 320, height: 740, scale: 2, fontScale: 2 });
  mockReducedMotion = true;
  mockParams = {
    groupId: 'group',
    groupName: 'A long group name with friends from several classes',
  };
  await render();
  const category = tree.root.findByType(CategoryCards);
  expect(
    category
      .findAllByProps({ accessibilityRole: 'radio' })
      .filter((n: any) => n.props.onPress)
      .map((n: any) => n.props.accessibilityLabel),
  ).toEqual(['Food', 'Activities', 'Food + Activities', 'Custom']);
  expect(category.findAllByType(Text).every((n: any) => n.props.numberOfLines === undefined)).toBe(
    true,
  );
  expect(row("Who's joining?").props.value).toContain(mockParams.groupName);
  await press('Where');
  expect(tree.root.findByType(Modal).props.animationType).toBe('none');
  const label = 'A location name that should wrap instead of disappearing';
  await act(async () =>
    tree.root.findByType(LocationSearch).props.onPick({ lat: 41, lng: -72 }, label),
  );
  await act(async () => button('Use this location').props.onPress());
  expect(row('Where').props.value).toBe(`${label} · 2 mi`);
});

test('landscape keeps map outside scroll gestures while search and radius remain accessible', async () => {
  jest
    .spyOn(jest.requireActual('react-native'), 'useWindowDimensions')
    .mockReturnValue({ width: 740, height: 320, scale: 2, fontScale: 1 });
  await render();
  await press('Where');
  expect(tree.root.findByType(MapPicker).findAllByType(ScrollView)).toHaveLength(0);
  expect(tree.root.findByType(LocationSearch)).toBeDefined();
  expect(tree.root.findByType('test-slider').props.accessibilityLabel).toBe(
    'Search radius in miles',
  );
  const scrolls = tree.root.findAllByType(ScrollView);
  expect(scrolls.some((scroll: any) => scroll.findAllByType(MapPicker).length > 0)).toBe(false);
  await act(async () => button('Cancel').props.onPress());
});

test('When defaults to Decide later and commits optional proposed time with deferred deadline', async () => {
  const at = new Date(Date.now() + 2 * 86400000).toISOString();
  await render();
  expect(row('When').props.value).toBe('Decide later');
  await press('When');
  await act(async () => tree.root.findByType(PlanTimeSheet).props.onSave(at));
  await act(async () => tree.root.findByType(PlanTimeSheet).props.onClose());
  expect(row('When').props.value).not.toBe('Decide later');
  await act(async () => button('Create Pick').props.onPress());
  expect(api.createPick).toHaveBeenCalledWith(
    expect.objectContaining({ proposedAt: at, swipeDeadlineMinutes: 60, deadlineAt: null }),
    'owner',
  );
  expect(router.replace).toHaveBeenCalledWith({
    pathname: '/pick/[id]/swipe',
    params: { id: 'pick' },
  });
});
test('When cancellation discards changes and Decide later restores legacy payload', async () => {
  await render();
  await press('When');
  await act(async () => tree.root.findByType(PlanTimeSheet).props.onClose());
  expect(row('When').props.value).toBe('Decide later');
  await press('When');
  await act(async () =>
    tree.root
      .findByType(PlanTimeSheet)
      .props.onSave(new Date(Date.now() + 2 * 86400000).toISOString()),
  );
  await act(async () => tree.root.findByType(PlanTimeSheet).props.onClose());
  await press('When');
  await act(async () => tree.root.findByType(PlanTimeSheet).props.onDecideLater());
  await act(async () => button('Create Pick').props.onPress());
  expect(jest.mocked(api.createPick).mock.calls[0]![0]).not.toHaveProperty('proposedAt');
});
test('Hang conversion keeps scheduling control absent and existing payload unchanged', async () => {
  mockParams = { hangId: 'hang' };
  await render();
  expect(row('When')).toBeUndefined();
  await act(async () => button('Create Pick').props.onPress());
  expect(jest.mocked(api.hangPick).mock.calls[0]![1]).not.toHaveProperty('proposedAt');
});

test('disabled capability hides scheduling and keeps ordinary creation usable', async () => {
  jest.mocked(api.getPickCapabilities).mockResolvedValueOnce({ availabilityFirst: false });
  await render();
  expect(row('When')).toBeUndefined();
  await act(async () => button('Create Pick').props.onPress());
  const input = jest.mocked(api.createPick).mock.calls[0]![0];
  expect(input).not.toHaveProperty('proposedAt');
  expect(input).not.toHaveProperty('swipeDeadlineMinutes');
  expect(input.deadlineAt).not.toBeNull();
});
test('failed capability lookup hides When without blocking ordinary creation', async () => {
  jest.mocked(api.getPickCapabilities).mockRejectedValueOnce(new Error('Offline'));
  await render();
  expect(row('When')).toBeUndefined();
  await act(async () => button('Create Pick').props.onPress());
  expect(api.createPick).toHaveBeenCalledTimes(1);
});
test('loading capability does not block an ordinary Pick; late account response is ignored', async () => {
  let resolve!: (value: { availabilityFirst: boolean; availabilityMode: string }) => void;
  jest.mocked(api.getPickCapabilities).mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    }),
  );
  await render();
  expect(row('When')).toBeUndefined();
  await act(async () => button('Create Pick').props.onPress());
  expect(api.createPick).toHaveBeenCalledTimes(1);
  jest.mocked(api.getPickCapabilities).mockResolvedValueOnce({ availabilityFirst: false });
  mockAccount = 'replacement';
  await act(async () => tree.update(<CreatePickScreen />));
  await act(async () => resolve({ availabilityFirst: true, availabilityMode: 'immediate' }));
  expect(row('When')).toBeUndefined();
  expect(api.getPickCapabilities).toHaveBeenLastCalledWith('replacement');
});
test('foreground capability loss invalidates an open time editor, keeps other fields, and rejects late editor saves', async () => {
  let onActive: ((state: 'active') => void) | undefined;
  const subscription = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_event, listener) => {
      onActive = listener;
      return { remove: jest.fn() };
    });
  try {
    await render();
    await choose('Number of places', 30);
    await press('When');
    const save = tree.root.findByType(PlanTimeSheet).props.onSave;
    await act(async () => save(new Date(Date.now() + 2 * 86400000).toISOString()));
    jest.mocked(api.getPickCapabilities).mockResolvedValueOnce({ availabilityFirst: false });
    await act(async () => onActive?.('active'));
    await act(async () => save(new Date(Date.now() + 2 * 86400000).toISOString()));
    expect(row('When')).toBeUndefined();
    expect(tree.root.findAllByType(PlanTimeSheet)).toHaveLength(0);
    await act(async () => button('Create Pick').props.onPress());
    const input = jest.mocked(api.createPick).mock.calls[0]![0];
    expect(input.poolSize).toBe(30);
    expect(input).not.toHaveProperty('proposedAt');
    expect(input).not.toHaveProperty('swipeDeadlineMinutes');
    expect(input.deadlineAt).not.toBeNull();
  } finally {
    subscription.mockRestore();
  }
});
test('latest capability refresh wins over a delayed enabled response', async () => {
  let onActive: ((state: 'active') => void) | undefined;
  const subscription = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_event, listener) => {
      onActive = listener;
      return { remove: jest.fn() };
    });
  try {
    let resolve!: (value: { availabilityFirst: boolean; availabilityMode: string }) => void;
    jest.mocked(api.getPickCapabilities).mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    );
    await render();
    jest.mocked(api.getPickCapabilities).mockResolvedValueOnce({ availabilityFirst: false });
    await act(async () => onActive?.('active'));
    await act(async () => resolve({ availabilityFirst: true, availabilityMode: 'immediate' }));
    expect(row('When')).toBeUndefined();
  } finally {
    subscription.mockRestore();
  }
});

test('creation preflight disabling scheduling clears the selection for a normal retry', async () => {
  await render();
  await press('When');
  await act(async () =>
    tree.root
      .findByType(PlanTimeSheet)
      .props.onSave(new Date(Date.now() + 2 * 86400000).toISOString()),
  );
  await act(async () => tree.root.findByType(PlanTimeSheet).props.onClose());
  jest
    .mocked(api.createPick)
    .mockRejectedValueOnce(
      Object.assign(new Error('Disabled'), { code: 'availability_not_enabled', status: 409 }),
    );
  await act(async () => button('Create Pick').props.onPress());
  expect(row('When')).toBeUndefined();
  await act(async () => button('Create Pick').props.onPress());
  expect(jest.mocked(api.createPick).mock.calls[1]![0]).not.toHaveProperty('proposedAt');
  expect(jest.mocked(api.createPick).mock.calls[1]![0]).not.toHaveProperty('swipeDeadlineMinutes');
});

test('explicit enabled capability shows When and is not refetched by form edits', async () => {
  jest.mocked(api.getPickCapabilities).mockResolvedValueOnce({ availabilityFirst: true });
  await render();
  expect(row('When')).toBeDefined();
  await act(async () => chips('Category').props.onChange('activities'));
  expect(api.getPickCapabilities).toHaveBeenCalledTimes(1);
  expect(api.getPickCapabilities).toHaveBeenCalledWith('owner');
});

test('saved category, budget and clamped distance defaults coexist with scheduled creation', async () => {
  mockPreferences = {
    ...EMPTY_PREFERENCES,
    categories: ['activities'],
    priceMax: 2,
    maxDistanceM: 25 * 1609,
  };
  await render();
  expect(chips('Category').props.value).toBe('activities');
  expect(row('Where').props.value).toContain('10 mi');
  await press('When');
  const at = new Date(Date.now() + 2 * 86400000).toISOString();
  await act(async () => tree.root.findByType(PlanTimeSheet).props.onSave(at));
  await act(async () => tree.root.findByType(PlanTimeSheet).props.onClose());
  await act(async () => button('Create Pick').props.onPress());
  expect(api.createPick).toHaveBeenCalledWith(
    expect.objectContaining({
      category: 'activities',
      priceMax: 2,
      radiusM: milesToMeters(10),
      proposedAt: at,
      swipeDeadlineMinutes: 60,
      deadlineAt: null,
    }),
    'owner',
  );
});
test('late profile updates do not reset selected category, scheduled time or open location draft', async () => {
  mockProfileLoading = true;
  await render();
  await act(async () => chips('Category').props.onChange('activities'));
  await press('When');
  const at = new Date(Date.now() + 2 * 86400000).toISOString();
  await act(async () => tree.root.findByType(PlanTimeSheet).props.onSave(at));
  await act(async () => tree.root.findByType(PlanTimeSheet).props.onClose());
  await press('Where');
  const search = tree.root.findByType(LocationSearch);
  await act(async () => search.props.onPick({ lat: 41, lng: -72 }, 'Draft location'));
  mockPreferences = { ...EMPTY_PREFERENCES, categories: ['food'], priceMax: 4, maxDistanceM: 1609 };
  mockProfileLoading = false;
  await act(async () => tree.update(<CreatePickScreen />));
  expect(chips('Category').props.value).toBe('activities');
  expect(tree.root.findAllByType(LocationSearch)).toHaveLength(1);
  await act(async () => button('Use this location').props.onPress());
  expect(row('When').props.value).not.toBe('Decide later');
  await act(async () => button('Create Pick').props.onPress());
  expect(api.createPick).toHaveBeenCalledWith(
    expect.objectContaining({
      category: 'activities',
      priceMax: null,
      center: { lat: 41, lng: -72 },
      proposedAt: at,
    }),
    'owner',
  );
  expect(api.getPickCapabilities).toHaveBeenCalledTimes(1);
});
test('Hang category prefill takes precedence over saved food defaults without scheduling', async () => {
  mockParams = { hangId: 'hang', hangActivity: 'Basketball' };
  mockPreferences = {
    ...EMPTY_PREFERENCES,
    categories: ['food'],
    priceMax: 3,
    maxDistanceM: 5 * 1609,
  };
  await render();
  expect(chips('Category').props.value).toBe('activities');
  expect(row('When')).toBeUndefined();
  await act(async () => button('Create Pick').props.onPress());
  expect(api.hangPick).toHaveBeenCalledWith(
    'hang',
    expect.objectContaining({ category: 'activities', priceMax: 3, radiusM: milesToMeters(5) }),
  );
  expect(api.getPickCapabilities).not.toHaveBeenCalled();
});
