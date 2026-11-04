import React from 'react';
import { Text } from 'react-native';
import DiscoverScreen from '../../app/(tabs)/discover';
import { api } from '@/lib/api';
import { CAMPUS } from '@/lib/places';
import type { Candidate } from '@shared/places/types.ts';

const { create, act } = jest.requireActual('react-test-renderer');
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ session: { user: { id: 'me' } } }) }));
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
jest.mock('@/components/PlaceFilterControls', () => ({
  PlaceFilterControls: (props: object) =>
    jest.requireActual('react').createElement('test-filters', props),
}));
jest.mock('@/components/Chips', () => ({
  Chips: (props: object) => jest.requireActual('react').createElement('test-chips', props),
}));
jest.mock('@/components/TabUi', () => ({
  QuietEmpty: (props: object) => jest.requireActual('react').createElement('test-empty', props),
  Sheet: ({ visible, ...props }: { visible: boolean }) =>
    visible ? jest.requireActual('react').createElement('test-sheet', props) : null,
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
  expect(tree.root.findByType('test-empty').props.title).toBe('Nothing matches');
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
test('filter sheet preserves draft/apply/reset semantics, price and distance', async () => {
  const tree = await mount();
  await act(async () => press(tree, 'Filters'));
  const calls = jest.mocked(api.discover).mock.calls.length;
  await act(async () => {
    tree.root.findByType('test-filters').props.onPrice(2);
    tree.root.findByType('test-filters').props.onOpen(true);
    tree.root.findByType('test-chips').props.onChange(1000);
  });
  expect(api.discover).toHaveBeenCalledTimes(calls);
  await act(async () => button(tree, 'Show places').props.onPress());
  expect(api.discover).toHaveBeenLastCalledWith({
    ...CAMPUS,
    category: 'all',
    radiusM: 1000,
    priceMax: 2,
    openNow: true,
  });
  await act(async () => press(tree, 'Filters'));
  await act(async () => button(tree, 'Reset filters').props.onPress());
  await act(async () => button(tree, 'Show places').props.onPress());
  expect(api.discover).toHaveBeenLastCalledWith({
    ...CAMPUS,
    category: 'all',
    radiusM: 5000,
    priceMax: undefined,
    openNow: false,
  });
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
  expect(tree.root.findByType('test-empty').props.title).toBe('Nothing matches');
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
