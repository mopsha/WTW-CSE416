import React from 'react';
import { AppState, FlatList, Text, Switch } from 'react-native';
import DiscoverScreen from '../../app/(tabs)/discover';
import { api } from '@/lib/api';
import { clearPhotoCache } from '@/lib/photoCache';
import { CAMPUS } from '@/lib/places';
import type { Candidate } from '@shared/places/types.ts';

let mockUser = 'me';
const { create, act } = jest.requireActual('react-test-renderer');
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useFocusEffect: (fn: () => void) => jest.requireActual('react').useEffect(fn, [fn]),
}));
jest.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ session: { user: { id: mockUser } } }) }));
jest.mock('@/lib/api', () => ({
  api: {
    discover: jest.fn(),
    discoverPhoto: jest.fn(),
    getSaved: jest.fn(),
    savePlace: jest.fn(),
    removeSaved: jest.fn(),
  },
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
  clearPhotoCache();
  AppState.currentState = 'active';
  jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
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
  expect(api.savePlace).toHaveBeenCalledWith('food', 'me');
  await act(async () => press(tree, 'Unsave Campus Cafe'));
  expect(api.removeSaved).toHaveBeenCalledWith('food', 'me');
  await act(async () => press(tree, 'Campus Cafe'));
  expect(textOf(tree)).toContain('Ana Photographer');
  expect(textOf(tree)).toContain('Google Maps');
  await act(async () => tree.unmount());
});
test('lazy covers load once when a card is viewed, then add the photographer credit', async () => {
  const lazy: Candidate = {
    ...places[1]!,
    photos: [{ name: 'places/m/photos/1', authorAttributions: [{ displayName: 'Bo Lens' }] }],
  };
  jest.mocked(api.discover).mockResolvedValue({ places: [lazy], fallback: false, notice: null });
  let resolve!: (value: { photoUrl: string }) => void;
  jest.mocked(api.discoverPhoto).mockReturnValue(new Promise((r) => (resolve = r)));
  const tree = await mount();
  // Pending: a placeholder, not the plain icon cover, and nothing fetched until viewed.
  expect(tree.root.findByType('test-photo').props.uri).toBeNull();
  expect(api.discoverPhoto).not.toHaveBeenCalled();
  const list = tree.root.findByType(FlatList);
  const item = list.props.data[0];
  await act(async () => {
    for (let i = 0; i < 2; i++)
      list.props.onViewableItemsChanged({ viewableItems: [{ item, isViewable: true }] });
  });
  expect(api.discoverPhoto).toHaveBeenCalledTimes(1);
  expect(api.discoverPhoto).toHaveBeenCalledWith('places/m/photos/1', 'me');
  await act(async () => resolve({ photoUrl: 'https://example.test/museum.jpg' }));
  expect(tree.root.findByType('test-photo').props.uri).toBe('https://example.test/museum.jpg');
  await act(async () => press(tree, 'Local Museum'));
  expect(textOf(tree)).toContain('Bo Lens');
  expect(api.discoverPhoto).toHaveBeenCalledTimes(1);
  await act(async () => tree.unmount());
});
test('a failed lazy cover falls back to the icon cover without retrying', async () => {
  const lazy: Candidate = {
    ...places[1]!,
    photos: [{ name: 'places/m/photos/1', authorAttributions: [] }],
  };
  jest.mocked(api.discover).mockResolvedValue({ places: [lazy], fallback: false, notice: null });
  jest.mocked(api.discoverPhoto).mockRejectedValue(new Error('rate limited'));
  const tree = await mount();
  await act(async () => press(tree, 'Local Museum'));
  expect(tree.root.findAllByType('test-photo')).toHaveLength(0);
  await act(async () => press(tree, 'Close'));
  await act(async () => press(tree, 'Local Museum'));
  expect(api.discoverPhoto).toHaveBeenCalledTimes(1);
  await act(async () => tree.unmount());
});
test('a refreshed place with a new photo shows that photo, not the old one with the new credit', async () => {
  const withPhoto = (name: string, by: string): Candidate => ({
    ...places[1]!,
    photos: [{ name, authorAttributions: [{ displayName: by }] }],
  });
  jest
    .mocked(api.discover)
    .mockResolvedValueOnce({
      places: [withPhoto('places/m/photos/1', 'Bo Lens')],
      fallback: false,
      notice: null,
    })
    .mockResolvedValue({
      places: [withPhoto('places/m/photos/2', 'Cy Shutter')],
      fallback: false,
      notice: null,
    });
  let finishNext!: (value: { photoUrl: string }) => void;
  jest
    .mocked(api.discoverPhoto)
    .mockResolvedValueOnce({ photoUrl: 'https://example.test/places/m/photos/1' })
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finishNext = resolve;
      }),
    );
  const tree = await mount();
  const view = async () => {
    const list = tree.root.findByType(FlatList);
    await act(async () =>
      list.props.onViewableItemsChanged({
        viewableItems: [{ item: list.props.data[0], isViewable: true }],
      }),
    );
  };
  await view();
  expect(tree.root.findByType('test-photo').props.uri).toBe(
    'https://example.test/places/m/photos/1',
  );
  // Another filter fetches the feed again, and the same place comes back with another photo.
  await act(async () => press(tree, 'Activities'));
  // The new photo hasn't loaded yet: a placeholder, never the old image.
  expect(tree.root.findByType('test-photo').props.uri).toBeNull();
  // Old-query visibility must not start work for the new filtered feed.
  expect(api.discoverPhoto).toHaveBeenCalledTimes(1);
  await view();
  await act(async () => finishNext({ photoUrl: 'https://example.test/places/m/photos/2' }));
  expect(tree.root.findByType('test-photo').props.uri).toBe(
    'https://example.test/places/m/photos/2',
  );
  await act(async () => press(tree, 'Local Museum'));
  expect(textOf(tree)).toContain('Cy Shutter');
  expect(textOf(tree)).not.toContain('Bo Lens');
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

test('same-query retry failure retains usable cards without skeletons; a changed query hides them', async () => {
  const tree = await mount();
  jest.mocked(api.savePlace).mockRejectedValueOnce(new Error('Save offline'));
  await act(async () => press(tree, 'Save Campus Cafe'));
  jest.mocked(api.discover).mockRejectedValueOnce(new Error('Feed offline'));
  await act(async () => tree.root.findByType('test-error').props.onRetry());
  expect(textOf(tree)).toContain('Campus Cafe');
  expect(tree.root.findAllByProps({ accessibilityLabel: 'Loading places' })).toHaveLength(0);
  let finish!: (v: any) => void;
  jest.mocked(api.discover).mockReturnValueOnce(
    new Promise((r) => {
      finish = r;
    }),
  );
  await act(async () => press(tree, 'Open Now'));
  expect(textOf(tree)).not.toContain('Campus Cafe');
  expect(tree.root.findAllByProps({ accessibilityLabel: 'Loading places' }).length).toBeGreaterThan(
    0,
  );
  await act(async () => finish({ places: [], fallback: false, notice: null }));
  expect(tree.root.findAllByProps({ accessibilityLabel: 'Loading places' })).toHaveLength(0);
  expect(tree.root.findByType('test-empty')).toBeDefined();
  await act(async () => tree.unmount());
});

test('a deferred favorite updates the card and open details immediately; the latest opposite choice is serialized', async () => {
  let resolve!: (v: { status: 'ok' }) => void;
  jest.mocked(api.savePlace).mockReturnValueOnce(
    new Promise((yes) => {
      resolve = yes;
    }),
  );
  const tree = await mount();
  await act(async () => press(tree, 'Save Campus Cafe'));
  const selected = tree.root.findAll(
    (n: any) => n.props.accessibilityLabel === 'Unsave Campus Cafe' && !!n.props.onPress,
  )[0]!;
  expect(selected.props.accessibilityState.selected).toBe(true);
  expect(selected.props.disabled).toBe(false);
  await act(async () => press(tree, 'Campus Cafe'));
  expect(button(tree, 'Remove saved place')).toBeDefined();
  await act(async () => button(tree, 'Remove saved place').props.onPress());
  expect(button(tree, 'Save place')).toBeDefined();
  expect(api.removeSaved).not.toHaveBeenCalled();
  await act(async () => resolve({ status: 'ok' }));
  expect(api.removeSaved).toHaveBeenCalledWith('food', 'me');
  expect(button(tree, 'Undo')).toBeDefined();
  await act(async () => button(tree, 'Undo').props.onPress());
  expect(button(tree, 'Remove saved place')).toBeDefined();
  await act(async () => tree.unmount());
});

test('switching accounts during a pending favorite discards its queued inverse and Undo', async () => {
  let resolve!: (v: { status: 'ok' }) => void;
  jest.mocked(api.savePlace).mockReturnValueOnce(
    new Promise((yes) => {
      resolve = yes;
    }),
  );
  const tree = await mount();
  await act(async () => press(tree, 'Save Campus Cafe'));
  await act(async () => press(tree, 'Unsave Campus Cafe'));
  mockUser = 'B';
  await act(async () => tree.update(<DiscoverScreen />));
  await act(async () => resolve({ status: 'ok' }));
  expect(api.removeSaved).not.toHaveBeenCalled();
  expect(tree.root.findAllByProps({ accessibilityLabel: 'Unsave Campus Cafe' })).toHaveLength(0);
  expect(button(tree, 'Undo')).toBeUndefined();
  await act(async () => tree.unmount());
});

test('sort, Open Now and Filters share a wrapping toolbar with full labels and actual minimum targets', async () => {
  const { StyleSheet } = jest.requireActual('react-native');
  const { MIN_TARGET } = jest.requireActual('@/components/theme');
  const tree = await mount();
  const controls = ['Sort places', 'Open Now', 'Filters'].map(
    (label) =>
      tree.root.findAll(
        (n: any) =>
          n.props.accessibilityLabel === label &&
          typeof n.props.onPress === 'function' &&
          n.props.style,
      )[0]!,
  );
  const row = controls[0].parent;
  expect(controls.every((n: any) => n.parent === row)).toBe(true);
  expect(StyleSheet.flatten(row.props.style).flexWrap).toBe('wrap');
  for (const control of controls) {
    const style = StyleSheet.flatten(control.props.style);
    expect(style.minHeight).toBeGreaterThanOrEqual(MIN_TARGET);
    expect(style.minWidth).toBeGreaterThanOrEqual(MIN_TARGET);
    expect(style.maxWidth).toBe('100%');
    expect(control.props.hitSlop).toBeUndefined();
  }
  expect(textOf(tree)).toContain('Activities');
  expect(textOf(tree)).toContain('limited selection');
  expect(textOf(tree)).toContain('nearby');
  await act(async () => controls[1].props.onPress());
  const open = tree.root.findAll(
    (n: any) => n.props.accessibilityLabel === 'Open Now' && !!n.props.onPress,
  )[0]!;
  expect(open.props.accessibilityState.checked).toBe(true);
  await act(async () => tree.unmount());
});

async function viewFirstPhoto(tree: ReturnType<typeof create>) {
  const list = tree.root.findByType(FlatList);
  await act(async () =>
    list.props.onViewableItemsChanged({
      viewableItems: [{ item: list.props.data[0], isViewable: true }],
    }),
  );
}
function photoFeed(name: string) {
  return {
    places: [
      {
        ...places[1]!,
        photos: [
          {
            name,
            authorAttributions: [
              { displayName: name, uri: 'https://maps.google.com/photographer' },
            ],
          },
        ],
      },
    ],
    fallback: false,
    notice: null,
  };
}

test('account B requests its own photo while A is pending; late A cannot change B', async () => {
  jest.mocked(api.discover).mockResolvedValue(photoFeed('places/p/photos/1'));
  let finishA!: (value: { photoUrl: string }) => void;
  jest
    .mocked(api.discoverPhoto)
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finishA = resolve;
      }),
    )
    .mockResolvedValue({ photoUrl: 'https://img/B' });
  const tree = await mount();
  await viewFirstPhoto(tree);
  mockUser = 'B';
  await act(async () => tree.update(<DiscoverScreen />));
  await viewFirstPhoto(tree);
  expect(api.discoverPhoto).toHaveBeenCalledTimes(2);
  expect(api.discoverPhoto).toHaveBeenLastCalledWith('places/p/photos/1', 'B');
  await act(async () => finishA({ photoUrl: 'https://img/old-A' }));
  expect(tree.root.findByType('test-photo').props.uri).toBe('https://img/B');
  await act(async () => tree.unmount());
});

test('mounted visible feed retries failures using fresh metadata after five minutes', async () => {
  jest.useFakeTimers();
  let tree: ReturnType<typeof create> | undefined;
  try {
    jest
      .mocked(api.discover)
      .mockResolvedValueOnce(photoFeed('places/p/photos/old'))
      .mockResolvedValue(photoFeed('places/p/photos/new'));
    jest
      .mocked(api.discoverPhoto)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ photoUrl: 'https://img/new' });
    tree = await mount();
    await viewFirstPhoto(tree);
    expect(api.discoverPhoto).toHaveBeenCalledTimes(1);
    await act(async () => jest.advanceTimersByTime(6 * 60_000));
    expect(api.discover).toHaveBeenCalledTimes(2);
    expect(api.discoverPhoto).toHaveBeenCalledTimes(2);
    expect(api.discoverPhoto).toHaveBeenLastCalledWith('places/p/photos/new', 'me');
    expect(tree.root.findByType('test-photo').props.uri).toBe('https://img/new');
  } finally {
    if (tree) await act(async () => tree!.unmount());
    clearPhotoCache();
    jest.useRealTimers();
  }
});

test('mounted visible feed expires old URLs and shows a placeholder while fresh metadata loads', async () => {
  jest.useFakeTimers();
  let tree: ReturnType<typeof create> | undefined;
  try {
    let finish!: (value: ReturnType<typeof photoFeed>) => void;
    jest
      .mocked(api.discover)
      .mockResolvedValueOnce(photoFeed('places/p/photos/old'))
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve;
        }),
      );
    jest
      .mocked(api.discoverPhoto)
      .mockImplementation(async (name) => ({ photoUrl: `https://img/${name}` }));
    tree = await mount();
    await viewFirstPhoto(tree);
    await act(async () => jest.advanceTimersByTime(51 * 60_000));
    expect(tree.root.findByType('test-photo').props.uri).toBeNull();
    expect(api.discoverPhoto).toHaveBeenCalledTimes(1);
    await act(async () => finish(photoFeed('places/p/photos/new')));
    expect(tree.root.findByType('test-photo').props.uri).toBe('https://img/places/p/photos/new');
  } finally {
    if (tree) await act(async () => tree!.unmount());
    clearPhotoCache();
    jest.useRealTimers();
  }
});

test('offscreen and background expiry does not request photos; foreground visible return revalidates', async () => {
  jest.useFakeTimers();
  let tree: ReturnType<typeof create> | undefined;
  try {
    jest.mocked(api.discover).mockResolvedValue(photoFeed('places/p/photos/current'));
    jest.mocked(api.discoverPhoto).mockResolvedValue({ photoUrl: 'https://img/current' });
    tree = await mount();
    await viewFirstPhoto(tree);
    const listeners = jest
      .mocked(AppState.addEventListener)
      .mock.calls.filter(([event]) => event === 'change')
      .map(([, listener]) => listener);
    await act(async () => listeners.forEach((listener) => listener('background')));
    await act(async () => jest.advanceTimersByTime(51 * 60_000));
    expect(api.discoverPhoto).toHaveBeenCalledTimes(1);
    await act(async () => listeners.forEach((listener) => listener('active')));
    expect(api.discoverPhoto).toHaveBeenCalledTimes(2);
    const list = tree.root.findByType(FlatList);
    await act(async () => list.props.onViewableItemsChanged({ viewableItems: [] }));
    await act(async () => jest.advanceTimersByTime(51 * 60_000));
    expect(api.discoverPhoto).toHaveBeenCalledTimes(2);
  } finally {
    if (tree) await act(async () => tree!.unmount());
    clearPhotoCache();
    jest.useRealTimers();
  }
});

test('foreground clock revalidation hides expired URLs even when background timers never ran', async () => {
  jest.useFakeTimers();
  let tree: ReturnType<typeof create> | undefined;
  try {
    let finish!: (value: ReturnType<typeof photoFeed>) => void;
    jest
      .mocked(api.discover)
      .mockResolvedValueOnce(photoFeed('places/p/photos/old'))
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve;
        }),
      );
    jest
      .mocked(api.discoverPhoto)
      .mockImplementation(async (name) => ({ photoUrl: `https://img/${name}` }));
    tree = await mount();
    await viewFirstPhoto(tree);
    const listeners = jest
      .mocked(AppState.addEventListener)
      .mock.calls.filter(([event]) => event === 'change')
      .map(([, listener]) => listener);
    await act(async () => listeners.forEach((listener) => listener('background')));
    jest.setSystemTime(Date.now() + 51 * 60_000); // intentionally do not run timers
    await act(async () => listeners.forEach((listener) => listener('active')));
    expect(tree.root.findByType('test-photo').props.uri).toBeNull();
    expect(api.discoverPhoto).toHaveBeenCalledTimes(1);
    await act(async () => finish(photoFeed('places/p/photos/new')));
    expect(tree.root.findByType('test-photo').props.uri).toBe('https://img/places/p/photos/new');
  } finally {
    if (tree) await act(async () => tree!.unmount());
    clearPhotoCache();
    jest.useRealTimers();
  }
});

test('failed metadata refresh backs off while rapid visibility changes do not amplify requests', async () => {
  jest.useFakeTimers();
  let tree: ReturnType<typeof create> | undefined;
  try {
    jest
      .mocked(api.discover)
      .mockResolvedValueOnce(photoFeed('places/p/photos/old'))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(photoFeed('places/p/photos/new'));
    jest
      .mocked(api.discoverPhoto)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ photoUrl: 'https://img/new' });
    tree = await mount();
    await viewFirstPhoto(tree);
    await act(async () => jest.advanceTimersByTime(6 * 60_000));
    expect(api.discover).toHaveBeenCalledTimes(2);
    for (let i = 0; i < 3; i++) {
      const list = tree.root.findByType(FlatList);
      await act(async () => list.props.onViewableItemsChanged({ viewableItems: [] }));
      await viewFirstPhoto(tree);
    }
    expect(api.discover).toHaveBeenCalledTimes(2);
    await act(async () => jest.advanceTimersByTime(5 * 60_000));
    expect(api.discover).toHaveBeenCalledTimes(3);
    expect(tree.root.findByType('test-photo').props.uri).toBe('https://img/new');
  } finally {
    if (tree) await act(async () => tree!.unmount());
    clearPhotoCache();
    jest.useRealTimers();
  }
});
