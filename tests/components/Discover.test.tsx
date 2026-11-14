import React from 'react';
import { Text, Switch } from 'react-native';
import DiscoverScreen from '../../app/(tabs)/discover';
import { api } from '@/lib/api';
import { CAMPUS } from '@/lib/places';
import type { Candidate } from '@shared/places/types.ts';

let mockUser = 'me';
const { create, act } = jest.requireActual('react-test-renderer');
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ session: { user: { id: mockUser } } }) }));
jest.mock('@/lib/api', () => ({
  api: { discover: jest.fn(), getSaved: jest.fn(), savePlace: jest.fn(), removeSaved: jest.fn() },
}));
jest.mock('@/lib/haptics', () => ({ haptic: { tap: jest.fn() } }));
jest.mock('@/components/PlaceCard', () => ({
  describePlace: (p: { name: string }) => p.name,
  PlacePhoto: (props: object) => jest.requireActual('react').createElement('test-photo', props),
}));
jest.mock('@/components/Button', () => ({
  Button: (props: object) => jest.requireActual('react').createElement('test-button', props),
}));
jest.mock('@/components/ErrorState', () => ({
  ErrorState: (props: object) => jest.requireActual('react').createElement('test-error', props),
}));
jest.mock('react-native/Libraries/Components/Switch/Switch', () => ({
  __esModule: true,
  default: jest
    .requireActual('react')
    .forwardRef((props: object, ref: unknown) =>
      jest.requireActual('react').createElement('test-switch', { ...props, ref }),
    ),
}));
jest.mock('@react-native-community/slider', () => ({
  __esModule: true,
  default: (props: object) => jest.requireActual('react').createElement('test-slider', props),
}));
jest.mock('@/components/TabUi', () => ({
  QuietEmpty: (props: object) => jest.requireActual('react').createElement('test-empty', props),
  Sheet: ({ visible, ...props }: { visible: boolean }) =>
    visible
      ? jest
          .requireActual('react')
          .createElement(
            'test-sheet',
            props,
            (props as any).headerRight,
            (props as any).children,
            (props as any).footer,
          )
      : null,
}));
const places: Candidate[] = [
  {
    placeId: 'food',
    name: 'Campus Cafe',
    category: 'food',
    ...CAMPUS,
    provider: 'google',
    priceLevel: 2,
    rating: 4.5,
    photoUrl: 'https://example.test/cafe.jpg',
    attributions: [{ provider: 'Ana Photographer' }],
  },
  {
    placeId: 'activity',
    name: 'Local Museum',
    category: 'activities',
    ...CAMPUS,
    provider: 'google',
  },
];
beforeEach(() => {
  jest.resetAllMocks();
  mockUser = 'me';
  jest.mocked(api.discover).mockResolvedValue({ places, fallback: false, notice: null });
  jest.mocked(api.getSaved).mockResolvedValue({ places: [] });
  jest.mocked(api.savePlace).mockResolvedValue({ status: 'ok' });
  jest.mocked(api.removeSaved).mockResolvedValue({ status: 'ok' });
});
async function mount() {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(<DiscoverScreen />);
  });
  return tree;
}
function press(tree: ReturnType<typeof create>, label: string) {
  return tree.root
    .findAllByProps({ accessibilityLabel: label })
    .find((n: { props: { onPress?: unknown } }) => typeof n.props.onPress === 'function')
    .props.onPress();
}
function button(tree: ReturnType<typeof create>, label: string) {
  return tree.root
    .findAllByType('test-button')
    .find((n: { props: { label: string } }) => n.props.label === label);
}
function textOf(tree: ReturnType<typeof create>) {
  return tree.root
    .findAllByType(Text)
    .map((node: { props: { children: unknown } }) => {
      const value = node.props.children;
      return typeof value === 'string'
        ? value
        : Array.isArray(value)
          ? value.filter((part) => typeof part === 'string').join('')
          : '';
    })
    .join('\n');
}
test('compact category/search controls preserve local search and provider request parameters', async () => {
  const tree = await mount();
  expect(api.discover).toHaveBeenLastCalledWith({
    ...CAMPUS,
    category: 'all',
    radiusM: 5000,
    priceMax: undefined,
    openNow: false,
  });
  expect(textOf(tree)).toContain('Places from Google Maps');
  expect(textOf(tree)).not.toContain('Find places to eat, hang out, and more.');
  await act(async () =>
    tree.root
      .findByProps({ accessibilityLabel: 'Search places' })
      .props.onChangeText('does not exist'),
  );
  expect(tree.root.findByType('test-empty').props.title).toBe('No places match your filters.');
  expect(api.discover).toHaveBeenCalledTimes(1); // search still filters locally
  await act(async () => press(tree, 'Clear search'));
  await act(async () => press(tree, 'Food'));
  expect(api.discover).toHaveBeenLastCalledWith(expect.objectContaining({ category: 'food' }));
  await act(async () => press(tree, 'Open Now'));
  expect(api.discover).toHaveBeenLastCalledWith(
    expect.objectContaining({ category: 'food', openNow: true }),
  );
  await act(async () => press(tree, 'Activities'));
  expect(api.discover).toHaveBeenLastCalledWith(
    expect.objectContaining({ category: 'activities', openNow: true }),
  );
  await act(async () => tree.unmount());
});
test('filter sheet applies all shared filters together; Reset changes only the draft', async () => {
  const tree = await mount();
  await act(async () => press(tree, 'Filters'));
  const calls = jest.mocked(api.discover).mock.calls.length;
  await act(async () => press(tree, 'Up to $$'));
  await act(async () => press(tree, '4.0+'));
  await act(async () => tree.root.findByType(Switch).props.onValueChange(true));
  await act(async () => tree.root.findByType('test-slider').props.onValueChange(10));
  expect(api.discover).toHaveBeenCalledTimes(calls);
  await act(async () => button(tree, 'Show places').props.onPress());
  expect(api.discover).toHaveBeenLastCalledWith(
    expect.objectContaining({
      category: 'all',
      radiusM: 16093,
      priceMax: 2,
      minRating: 4,
      openNow: true,
    }),
  );
  expect(textOf(tree)).toContain('Filters · 4');
  await act(async () => press(tree, 'Filters'));
  await act(async () => button(tree, 'Reset').props.onPress());
  expect(api.discover).toHaveBeenCalledTimes(calls + 1);
  await act(async () => button(tree, 'Show places').props.onPress());
  expect(api.discover).toHaveBeenLastCalledWith(
    expect.objectContaining({ radiusM: 5000, openNow: false }),
  );
  expect(jest.mocked(api.discover).mock.calls.at(-1)![0]).not.toHaveProperty('minRating');
  await act(async () => tree.unmount());
});
test('save/unsave, supplied imagery and photo-provider credits remain available', async () => {
  const tree = await mount();
  expect(tree.root.findByType('test-photo').props.uri).toBe('https://example.test/cafe.jpg');
  await act(async () => press(tree, 'Save Campus Cafe'));
  expect(api.savePlace).toHaveBeenCalledWith('food');
  await act(async () => press(tree, 'Unsave Campus Cafe'));
  expect(api.removeSaved).toHaveBeenCalledWith('food');
  await act(async () => press(tree, 'Campus Cafe'));
  expect(textOf(tree)).toContain('Ana Photographer');
  expect(textOf(tree)).toContain('Google Maps');
  await act(async () => tree.unmount());
});
test('failed feed keeps retry and the server notice is rendered without alteration', async () => {
  jest.mocked(api.discover).mockRejectedValueOnce(new Error('Offline')).mockResolvedValue({
    places: [],
    fallback: true,
    notice: 'Provider unavailable. Showing fallback results.',
  });
  const tree = await mount();
  expect(tree.root.findByType('test-error').props.message).toBe('Offline');
  await act(async () => tree.root.findByType('test-error').props.onRetry());
  expect(textOf(tree)).toContain('Provider unavailable. Showing fallback results.');
  expect(tree.root.findByType('test-empty').props.title).toBe('No places match your filters.');
  await act(async () => tree.unmount());
});

test('loading remains explicit until the feed resolves', async () => {
  let resolve!: (value: Awaited<ReturnType<typeof api.discover>>) => void;
  jest.mocked(api.discover).mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    }),
  );
  const tree = await mount();
  expect(textOf(tree)).toContain('Finding places…');
  expect(tree.root.findAllByProps({ accessibilityLabel: 'Loading places' }).length).toBeGreaterThan(
    0,
  );
  await act(async () => resolve({ places, fallback: false, notice: null }));
  expect(textOf(tree)).toContain('Campus Cafe');
  expect(tree.root.findAllByProps({ accessibilityLabel: 'Loading places' })).toHaveLength(0);
  await act(async () => tree.unmount());
});

test('adaptive sections preserve cuisine/activity selections independently and Any clears each section', async () => {
  const tree = await mount();
  await act(async () => press(tree, 'Filters'));
  expect(textOf(tree)).not.toContain('Cuisine');
  expect(textOf(tree)).not.toContain('Activity type');
  await act(async () => tree.root.findByType('test-sheet').props.onClose());
  await act(async () => press(tree, 'Food'));
  await act(async () => press(tree, 'Filters'));
  await act(async () => press(tree, 'Italian'));
  await act(async () => press(tree, 'Chinese'));
  await act(async () => press(tree, 'Pizza'));
  await act(async () => button(tree, 'Show places').props.onPress());
  expect(api.discover).toHaveBeenLastCalledWith(
    expect.objectContaining({ cuisines: ['chinese', 'italian'], foodTypes: ['pizza'] }),
  );
  await act(async () => press(tree, 'Activities'));
  expect(jest.mocked(api.discover).mock.calls.at(-1)![0]).not.toHaveProperty('cuisines');
  await act(async () => press(tree, 'Filters'));
  expect(textOf(tree)).toContain('Activity type');
  expect(textOf(tree)).not.toContain('Any cuisine');
  await act(async () => press(tree, 'Bowling'));
  await act(async () => button(tree, 'Show places').props.onPress());
  expect(api.discover).toHaveBeenLastCalledWith(
    expect.objectContaining({ activityTypes: ['bowling'] }),
  );
  await act(async () => press(tree, 'Food'));
  await act(async () => press(tree, 'Filters'));
  expect(
    tree.root.findAllByProps({ accessibilityLabel: 'Italian' }).find((n: any) => n.props.onPress)!
      .props.accessibilityState.checked,
  ).toBe(true);
  await act(async () => press(tree, 'Any cuisine'));
  await act(async () => button(tree, 'Show places').props.onPress());
  expect(jest.mocked(api.discover).mock.calls.at(-1)![0]).not.toHaveProperty('cuisines');
  expect(jest.mocked(api.discover).mock.calls.at(-1)![0]).toHaveProperty('foodTypes', ['pizza']);
  await act(async () => tree.unmount());
});
test('closing discards edits; applying an unchanged draft causes no extra request', async () => {
  const tree = await mount();
  await act(async () => press(tree, 'Filters'));
  await act(async () => press(tree, 'Free'));
  await act(async () => tree.root.findByType('test-sheet').props.onClose());
  expect(api.discover).toHaveBeenCalledTimes(1);
  await act(async () => press(tree, 'Filters'));
  await act(async () => press(tree, 'Free'));
  await act(async () => press(tree, 'Any price'));
  await act(async () => button(tree, 'Show places').props.onPress());
  expect(api.discover).toHaveBeenCalledTimes(1);
  await act(async () => tree.unmount());
});
test('Open Now stays synchronized between the feed and each fresh sheet draft', async () => {
  const tree = await mount();
  await act(async () => press(tree, 'Open Now'));
  await act(async () => press(tree, 'Filters'));
  expect(tree.root.findByType(Switch).props.value).toBe(true);
  await act(async () => tree.root.findByType(Switch).props.onValueChange(false));
  await act(async () => button(tree, 'Show places').props.onPress());
  expect(
    tree.root.findAllByProps({ accessibilityLabel: 'Open Now' }).find((n: any) => n.props.onPress)!
      .props.accessibilityState.checked,
  ).toBe(false);
  await act(async () => tree.unmount());
});
test('sort is outside Filters, requests bounded sorting, and photo promotion does not override it', async () => {
  const tree = await mount();
  jest
    .mocked(api.discover)
    .mockResolvedValue({ places: [places[1]!, places[0]!], notice: null, fallback: false });
  await act(async () => press(tree, 'Sort places'));
  await act(async () => press(tree, 'Highest rated'));
  expect(api.discover).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'rating' }));
  expect(textOf(tree).indexOf('Local Museum')).toBeLessThan(textOf(tree).indexOf('Campus Cafe'));
  expect(textOf(tree)).toContain('limited selection');
  await act(async () => tree.unmount());
});
test('an older request cannot overwrite the newly selected tab or account; account filters reset', async () => {
  const tree = await mount();
  let finish!: (v: Awaited<ReturnType<typeof api.discover>>) => void;
  jest.mocked(api.discover).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await act(async () => press(tree, 'Food'));
  await act(async () => press(tree, 'Activities'));
  await act(async () =>
    finish({ places: [{ ...places[0]!, name: 'Stale result' }], fallback: false, notice: null }),
  );
  expect(textOf(tree)).not.toContain('Stale result');
  await act(async () => press(tree, 'Open Now'));
  mockUser = 'other-account';
  await act(async () => tree.update(<DiscoverScreen />));
  expect(api.discover).toHaveBeenLastCalledWith(
    expect.objectContaining({ category: 'all', openNow: false, radiusM: 5000 }),
  );
  await act(async () => tree.unmount());
});
test('same-query refresh retains results while loading; initial failure stays distinct from empty', async () => {
  const tree = await mount();
  let finish!: (v: Awaited<ReturnType<typeof api.discover>>) => void;
  jest.mocked(api.discover).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  jest.mocked(api.savePlace).mockRejectedValueOnce(new Error('Offline'));
  await act(async () => press(tree, 'Save Campus Cafe'));
  await act(async () => tree.root.findByType('test-error').props.onRetry());
  expect(textOf(tree)).toContain('Campus Cafe');
  await act(async () => finish({ places: [], fallback: false, notice: null }));
  expect(tree.root.findByType('test-empty').props.title).toBe('No places match your filters.');
  expect(button(tree, 'Adjust filters')).toBeDefined();
  await act(async () => tree.unmount());
});

test('a previous account response cannot repopulate a newly mounted account feed', async () => {
  const tree = await mount();
  let finish!: (v: Awaited<ReturnType<typeof api.discover>>) => void;
  jest.mocked(api.discover).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await act(async () => press(tree, 'Open Now'));
  mockUser = 'new-account';
  await act(async () => tree.update(<DiscoverScreen />));
  await act(async () =>
    finish({
      places: [{ ...places[0]!, name: 'Previous account result' }],
      fallback: false,
      notice: null,
    }),
  );
  expect(textOf(tree)).not.toContain('Previous account result');
  await act(async () => tree.unmount());
});
