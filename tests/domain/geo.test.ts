import { distanceMeters } from '@shared/domain/geo.ts';

const campus = { lat: 40.9126, lng: -73.1234 };
test('same point is zero', () => expect(distanceMeters(campus, campus)).toBeCloseTo(0));
test('nearby northward point is about 445 meters', () => {
  expect(distanceMeters(campus, { ...campus, lat: 40.9166 })).toBeCloseTo(444.78, 1);
});
test('distance is symmetric', () => {
  const other = { lat: 41, lng: -72 };
  expect(distanceMeters(campus, other)).toBeCloseTo(distanceMeters(other, campus), 8);
});
test('New York to London is about 5570 km', () => {
  expect(
    distanceMeters({ lat: 40.7128, lng: -74.006 }, { lat: 51.5074, lng: -0.1278 }) / 1000,
  ).toBeCloseTo(5570, -1);
});
test('antipodes stay finite', () => {
  expect(distanceMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 180 })).toBeCloseTo(Math.PI * 6371000);
});
