import React from 'react';
import { AppState } from 'react-native';
import { TasteSwipe } from '@/components/TasteSwipe';
import { api } from '@/lib/api';
import { clearPhotoCache } from '@/lib/photoCache';
import type { Candidate } from '@shared/places/types.ts';

jest.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ session: { user: { id: 'me' } } }) }));
jest.mock('expo-router', () => ({
  useFocusEffect: (fn: () => void) => jest.requireActual('react').useEffect(fn, [fn]),
}));
const mountedTrees: { unmount: () => void }[] = [];
afterEach(async () => {
  await act(async () => {
    mountedTrees.splice(0).forEach((tree) => tree.unmount());
  });
  clearPhotoCache();
});

const { create, act } = jest.requireActual('react-test-renderer');
jest.mock('@/lib/api', () => ({ api: { discover: jest.fn(), discoverPhoto: jest.fn() } }));
jest.mock('@/components/SwipeCard', () => ({
  SwipeCard: jest
    .requireActual('react')
    .forwardRef((props: object, _ref: unknown) =>
      jest.requireActual('react').createElement('test-card', props),
    ),
}));
jest.mock('@/components/ActionBar', () => ({
  ActionBar: (props: object) => jest.requireActual('react').createElement('test-actions', props),
}));
jest.mock('@/components/ProgressBar', () => ({ ProgressBar: () => null }));

const center = { lat: 40.9, lng: -73.1 };
const google = (id: string, type: string, category: 'food' | 'activities'): Candidate =>
  ({
    placeId: id,
    provider: 'google',
    category,
    name: id,
    types: [type],
    lat: 40.9,
    lng: -73.1,
    photoUrl: null,
    photos: [
      {
        name: `places/${id}/photos/p`,
        authorAttributions: [{ displayName: `By ${id}`, uri: `https://maps.google.com/${id}` }],
      },
    ],
  }) as unknown as Candidate;

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
  clearPhotoCache();
  jest.mocked(api.discover).mockImplementation(async ({ category }) => ({
    places:
      category === 'food'
        ? [google('sushi', 'sushi_restaurant', 'food'), google('pizza', 'pizza_restaurant', 'food')]
        : [google('bowl', 'bowling_alley', 'activities')],
    fallback: false,
    notice: null,
  }));
  jest
    .mocked(api.discoverPhoto)
    .mockImplementation(async (name: string) => ({ photoUrl: `https://img/${name}` }));
});

async function render() {
  let tree: any;
  await act(async () => {
    tree = create(<TasteSwipe center={center} onDone={jest.fn()} />);
  });
  mountedTrees.push(tree);
  return tree;
}

test('loads photos only for the current and next card, with the photographer credit', async () => {
  const tree = await render();
  expect(api.discover).toHaveBeenCalledTimes(2);
  expect(jest.mocked(api.discoverPhoto).mock.calls.map(([n]) => n)).toEqual([
    'places/sushi/photos/p',
    'places/bowl/photos/p',
  ]);
  const card = tree.root.findByType('test-card');
  expect(card.props.place.photoUrl).toBe('https://img/places/sushi/photos/p');
  expect(card.props.place.attributions).toContainEqual({
    provider: 'By sushi',
    uri: 'https://maps.google.com/sushi',
  });
  expect(card.props.place.photoName).toBeUndefined();

  await act(async () => card.props.onAnswer(2));
  expect(api.discoverPhoto).toHaveBeenCalledTimes(3);
  expect(api.discoverPhoto).toHaveBeenLastCalledWith('places/pizza/photos/p', 'me');
  expect(tree.root.findByType('test-card').props.place.photoUrl).toBe(
    'https://img/places/bowl/photos/p',
  );
});

test('a failed photo leaves the card without one', async () => {
  jest.mocked(api.discoverPhoto).mockRejectedValue(new Error('rate limited'));
  const tree = await render();
  const place = tree.root.findByType('test-card').props.place;
  expect(place.photoUrl).toBeNull();
  expect(place.attributions ?? []).not.toContainEqual(
    expect.objectContaining({ provider: 'By sushi' }),
  );
});

test('mounted onboarding retries with fresh Discover references and preserves card progress', async () => {
  jest.useFakeTimers();
  try {
    jest.mocked(api.discover).mockImplementation(async ({ category }) => {
      const fresh = jest.mocked(api.discover).mock.calls.length > 2;
      const places =
        category === 'food'
          ? [google('sushi', 'sushi_restaurant', 'food')]
          : [google('bowl', 'bowling_alley', 'activities')];
      return {
        places: places.map((p) => ({
          ...p,
          photos: p.photos?.map((photo) => ({
            ...photo,
            name: `${photo.name}${fresh ? 'new' : 'old'}`,
          })),
        })),
        fallback: false,
        notice: null,
      };
    });
    jest.mocked(api.discoverPhoto).mockImplementation(async (name) => {
      if (name.endsWith('old')) throw new Error('offline');
      return { photoUrl: `https://img/${name}` };
    });
    const tree = await render();
    expect(tree.root.findByType('test-card').props.place.photoUrl).toBeNull();
    await act(async () => jest.advanceTimersByTime(6 * 60_000));
    expect(api.discover).toHaveBeenCalledTimes(4);
    expect(tree.root.findByType('test-card').props.place.name).toBe('sushi');
    expect(tree.root.findByType('test-card').props.place.photoUrl).toBe(
      'https://img/places/sushi/photos/pnew',
    );
    await act(async () => tree.root.findByType('test-card').props.onAnswer(2));
    expect(tree.root.findByType('test-card').props.place.name).toBe('bowl');
  } finally {
    await act(async () => mountedTrees.splice(0).forEach((tree) => tree.unmount()));
    clearPhotoCache();
    jest.useRealTimers();
  }
});

test('mounted onboarding expires URLs without resetting answers', async () => {
  jest.useFakeTimers();
  try {
    const tree = await render();
    await act(async () => tree.root.findByType('test-card').props.onAnswer(2));
    const before = tree.root.findByType('test-card').props.place.name;
    await act(async () => jest.advanceTimersByTime(51 * 60_000));
    expect(api.discover).toHaveBeenCalledTimes(4);
    expect(tree.root.findByType('test-card').props.place.name).toBe(before);
    expect(api.discoverPhoto).toHaveBeenCalledTimes(5); // three original covers, two current/next refreshed
  } finally {
    await act(async () => mountedTrees.splice(0).forEach((tree) => tree.unmount()));
    clearPhotoCache();
    jest.useRealTimers();
  }
});
