import React from 'react';
import { MapPicker } from '@/components/MapPicker';
const { create, act } = jest.requireActual('react-test-renderer');
const mockAnimate = jest.fn();
jest.mock('react-native-maps', () => {
  const React = jest.requireActual('react');
  return {
    __esModule: true,
    default: React.forwardRef(function MockMap(props: object, ref: unknown) {
      React.useImperativeHandle(ref, () => ({ animateToRegion: mockAnimate }));
      return React.createElement('test-map', props);
    }),
    Circle: 'test-circle',
    Marker: 'test-marker',
  };
});
test('camera refits after actual expand/collapse layouts, preserving center and radius', async () => {
  const center = { lat: 40.9, lng: -73.1 },
    onChangeCenter = jest.fn();
  let tree: any;
  const render = (height: number, radiusM = 3200) => (
    <MapPicker {...{ center, onChangeCenter, height, radiusM }} />
  );
  await act(async () => {
    tree = create(render(144));
  });
  const map = () => tree.root.findByType('test-map');
  await act(async () => map().props.onMapReady());
  expect(mockAnimate).not.toHaveBeenCalled();
  const layout = async (height: number) =>
    act(async () =>
      map().props.onLayout({
        nativeEvent: { layout: { width: 350, height } },
      }),
    );
  await layout(144);
  const compact = mockAnimate.mock.calls[0][0];
  await act(async () => tree.update(render(320)));
  expect(mockAnimate).toHaveBeenCalledTimes(1); // Wait for native layout.
  await layout(320);
  const expanded = mockAnimate.mock.calls[1][0];
  expect(expanded.longitudeDelta).toBeLessThan(compact.longitudeDelta);
  expect(expanded.latitudeDelta).toBe(compact.latitudeDelta);
  expect(expanded).toMatchObject({ latitude: center.lat, longitude: center.lng });
  expect(tree.root.findByType('test-circle').props.radius).toBe(3200);
  expect(tree.root.findByType('test-marker').props.coordinate).toEqual({
    latitude: center.lat,
    longitude: center.lng,
  });
  await act(async () => tree.update(render(144)));
  await layout(144);
  expect(mockAnimate.mock.calls[2][0]).toEqual(compact);
  await layout(144);
  expect(mockAnimate).toHaveBeenCalledTimes(3);
  await act(async () => tree.update(render(144, 6400)));
  expect(mockAnimate.mock.calls[3][0].latitudeDelta).toBe(compact.latitudeDelta * 2);
  expect(onChangeCenter).not.toHaveBeenCalled();
  await act(async () => tree.unmount());
});
