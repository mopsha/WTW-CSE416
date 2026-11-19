import React from 'react';
import { ScrollView, Switch } from 'react-native';
import { CategoryCards, ChoiceList } from '@/components/NewPickControls';
import { Button, Chips } from '@/components';
import { LocationSearch } from '@/components/LocationSearch';
import { CustomPlanEditor } from '@/components/CustomPlanEditor';
import { api } from '@/lib/api';
import { DEFAULT_POOL_SIZE, milesToMeters } from '@shared/domain/createPick.ts';

jest.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ session: { user: { id: 'owner' } } }) }));

// The override was used to execute these exact cases against the original route.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const CreatePickScreen = require(process.env.WTW_BASELINE ?? '../../app/pick/new').default;
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

// The same scenarios run against the saved pre-redesign route and this route.
const selectCategory = async (value: string) =>
  act(async () => {
    const old = chips('Category');
    if (old) old.props.onChange(value);
    else tree.root.findByType(CategoryCards).props.onChange(value);
  });
const choose = async (label: string, row: string, value: number) => {
  if (chips('Category')) {
    if (!chips(label)) await press('More options');
    await act(async () => chips(label).props.onChange(value));
  } else {
    await press(row);
    await act(async () => tree.root.findByType(ChoiceList).props.onChange(value));
  }
};
const toggle = async (label: string) => {
  if (chips('Category') && !chips('Pool size')) await press('More options');
  await act(async () =>
    tree.root
      .findAllByType(Switch)
      .find((n: any) => n.props.accessibilityLabel === label)
      .props.onValueChange(true),
  );
};
const scenarios = [
  'default Food',
  'Activities',
  'Food + Activities',
  'Custom',
  'Group',
  'Nongroup',
  'Hang',
  'Saved places',
  'Group Ideas',
  'Location and radius',
  'Price and Open Now',
  'Modified deadline',
  'No deadline',
  'Early close',
];
test.each(scenarios)('before/after API equivalence: %s', async (scenario) => {
  const now = Date.parse('2026-11-15T12:00:00.000Z');
  jest.spyOn(Date, 'now').mockReturnValue(now);
  if (scenario === 'Group' || scenario === 'Group Ideas')
    mockParams = { groupId: 'group', groupName: 'Crew' };
  if (scenario === 'Hang') mockParams = { hangId: 'hang', hangActivity: 'Basketball' };
  await render();
  const expected: any = {
    category: scenario === 'Hang' ? 'activities' : 'food',
    center: { lat: 40.915, lng: -73.123 },
    radiusM: milesToMeters(2),
    priceMax: null,
    openNow: false,
    poolSize: DEFAULT_POOL_SIZE,
    includeSaved: false,
    closeThreshold: 100,
    deadlineAt: new Date(now + 60 * 60_000).toISOString(),
    swipeMinutes: 60,
  };
  if (scenario === 'Activities' || scenario === 'Food + Activities') {
    expected.category = scenario === 'Activities' ? 'activities' : 'both';
    await selectCategory(expected.category);
  }
  if (scenario === 'Custom') {
    await selectCategory('custom');
    await act(async () =>
      tree.root.findByType(CustomPlanEditor).props.onChange([{ name: 'Chess' }, { name: 'Cards' }]),
    );
    Object.assign(expected, {
      category: 'custom',
      customOptions: [{ name: 'Chess' }, { name: 'Cards' }],
      poolSize: 2,
    });
  }
  if (scenario === 'Group' || scenario === 'Group Ideas')
    Object.assign(expected, { groupId: 'group', includeGroupIdeas: scenario === 'Group Ideas' });
  if (scenario === 'Group Ideas') await toggle('Include Group Ideas');
  if (scenario === 'Saved places') {
    await toggle('Include my saved places inside the radius');
    expected.includeSaved = true;
  }
  if (scenario === 'Location and radius') {
    if (chips('Category')) await press('More options');
    else await press('Where');
    await act(async () => {
      tree.root.findByType(LocationSearch).props.onPick({ lat: 41, lng: -72 }, 'Town');
      tree.root.findByType('test-slider').props.onValueChange(5);
    });
    if (!chips('Category')) await act(async () => button('Use this location').props.onPress());
    Object.assign(expected, { center: { lat: 41, lng: -72 }, radiusM: milesToMeters(5) });
  }
  if (scenario === 'Price and Open Now') {
    if (chips('Category')) await press('More options');
    else await press('Place filters');
    await act(async () => {
      chips('Maximum price').props.onChange(2);
      tree.root
        .findAllByType(Switch)
        .find((n: any) => n.props.accessibilityLabel === 'Only places known to be open now')
        .props.onValueChange(true);
    });
    if (!chips('Category')) await act(async () => button('Apply filters').props.onPress());
    Object.assign(expected, { priceMax: 2, openNow: true });
  }
  if (scenario === 'Modified deadline' || scenario === 'No deadline') {
    const value = scenario === 'No deadline' ? 0 : 180;
    await choose('Deadline', 'Swipe deadline', value);
    expected.deadlineAt = value ? new Date(now + value * 60_000).toISOString() : null;
    if (value) expected.swipeMinutes = value;
    else delete expected.swipeMinutes;
  }
  if (scenario === 'Early close') {
    await choose('Close threshold', 'Close early', 75);
    expected.closeThreshold = 75;
  }
  await act(async () => button('Create Pick').props.onPress());
  const endpoint =
    scenario === 'Hang' ? api.hangPick : mockParams.groupId ? api.createGroupPick : api.createPick;
  const args =
    scenario === 'Hang'
      ? ['hang', expected]
      : mockParams.groupId
        ? [expected, 'group']
        : [expected];
  expect(endpoint).toHaveBeenCalledTimes(1);
  expect(endpoint).toHaveBeenCalledWith(...args);
});
