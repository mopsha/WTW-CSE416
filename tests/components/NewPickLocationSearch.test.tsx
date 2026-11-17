import React from 'react';
import { TextInput } from 'react-native';
import { LocationSearch } from '@/components/LocationSearch';
import { currentLocation, searchLocations } from '@/lib/locationSearch';
const { create, act } = jest.requireActual('react-test-renderer');
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/lib/haptics', () => ({ haptic: { tap: jest.fn() } }));
jest.mock('@/lib/locationSearch', () => ({
  currentLocation: jest.fn(),
  searchLocations: jest.fn(),
}));
let tree: any;
const onPick = jest.fn();
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((r, j) => {
    resolve = r;
    reject = j;
  });
  return { promise, resolve, reject };
};
const press = async (label: string) =>
  act(async () =>
    tree.root
      .findAllByProps({ accessibilityLabel: label })
      .find((n: any) => n.props.onPress)
      .props.onPress(),
  );
const typeQuery = async (value: string) =>
  act(async () => tree.root.findByType(TextInput).props.onChangeText(value));
const tick = async () => act(async () => jest.advanceTimersByTime(300));
beforeEach(async () => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  jest.mocked(searchLocations).mockResolvedValue([]);
  await act(async () => {
    tree = create(<LocationSearch key={0} label="SBU" onPick={onPick} />);
  });
});
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
  jest.useRealTimers();
});
test('mounting does not request permission or geocode; queries retain debounce', async () => {
  await tick();
  expect(currentLocation).not.toHaveBeenCalled();
  expect(searchLocations).not.toHaveBeenCalled();
  await typeQuery('Po');
  await typeQuery('Port');
  await tick();
  expect(searchLocations).toHaveBeenCalledTimes(1);
  expect(searchLocations).toHaveBeenCalledWith('Port');
});
test('permission denial and location failures remain recoverable via retry and search', async () => {
  jest
    .mocked(currentLocation)
    .mockResolvedValueOnce(null)
    .mockRejectedValueOnce(new Error('Off'))
    .mockResolvedValueOnce({ lat: 41, lng: -72 });
  await press('Use my location');
  expect(JSON.stringify(tree.toJSON())).toContain(
    'Location is off for WTW. Search or drop the pin instead.',
  );
  await press('Use my location');
  expect(JSON.stringify(tree.toJSON())).toContain(
    'Couldn’t find you. Search or drop the pin instead.',
  );
  await press('Use my location');
  expect(onPick).toHaveBeenCalledWith({ lat: 41, lng: -72 }, 'My location');
});
test('newer queries suppress stale search results and errors', async () => {
  const first = deferred<any[]>();
  const second = deferred<any[]>();
  jest
    .mocked(searchLocations)
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  await typeQuery('Old');
  await tick();
  await typeQuery('New');
  await tick();
  await act(async () =>
    second.resolve([{ id: 'new', label: 'New town', detail: 'NY', center: { lat: 41, lng: -72 } }]),
  );
  await act(async () => first.reject(new Error('Old failure')));
  expect(JSON.stringify(tree.toJSON())).toContain('New town');
  expect(JSON.stringify(tree.toJSON())).not.toContain('Search isn’t available');
  await press('New town, NY');
  expect(onPick).toHaveBeenCalledWith({ lat: 41, lng: -72 }, 'New town');
});
test('map selection invalidates pending search and device location without another request', async () => {
  const location = deferred<any>();
  const search = deferred<any[]>();
  jest.mocked(currentLocation).mockReturnValue(location.promise);
  jest.mocked(searchLocations).mockReturnValue(search.promise);
  await typeQuery('Town');
  await tick();
  await press('Use my location');
  await act(async () =>
    tree.update(<LocationSearch label="Dropped pin" key={1} onPick={onPick} />),
  );
  await act(async () => {
    location.resolve({ lat: 0, lng: 0 });
    search.resolve([{ id: 'old', label: 'Old town', detail: '', center: { lat: 0, lng: 0 } }]);
  });
  expect(onPick).not.toHaveBeenCalled();
  expect(JSON.stringify(tree.toJSON())).not.toContain('Old town');
  await tick();
  expect(searchLocations).toHaveBeenCalledTimes(1);
  expect(currentLocation).toHaveBeenCalledTimes(1);
});
test('typing a new search supersedes an in-flight device location', async () => {
  const location = deferred<any>();
  jest.mocked(currentLocation).mockReturnValue(location.promise);
  await press('Use my location');
  await typeQuery('New place');
  await act(async () => location.resolve({ lat: 0, lng: 0 }));
  expect(onPick).not.toHaveBeenCalled();
});
test.each(['resolve', 'reject'])(
  'closing an editor silences late location %s and search results',
  async (outcome) => {
    const location = deferred<any>();
    const search = deferred<any[]>();
    jest.mocked(currentLocation).mockReturnValue(location.promise);
    jest.mocked(searchLocations).mockReturnValue(search.promise);
    await typeQuery('Town');
    await tick();
    await press('Use my location');
    await act(async () => tree.unmount());
    tree = null;
    await act(async () => {
      if (outcome === 'resolve') location.resolve({ lat: 0, lng: 0 });
      else location.reject(new Error('Off'));
      search.resolve([]);
    });
    expect(onPick).not.toHaveBeenCalled();
  },
);
