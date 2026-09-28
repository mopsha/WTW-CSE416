import { distanceMeters } from '@shared/domain/geo.ts';
import { scoreCandidate } from '@shared/domain/ranking.ts';

describe('@shared alias', () => {
  test('resolves domain modules', () => {
    expect(distanceMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 0 })).toBe(0);
    expect(typeof scoreCandidate).toBe('function');
  });
});
