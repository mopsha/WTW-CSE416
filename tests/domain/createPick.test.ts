import {
  MAX_RADIUS_M,
  metersToMiles,
  milesToMeters,
  validateCreatePick,
  type CreatePickInput,
} from '@shared/domain/createPick.ts';

const NOW = Date.parse('2026-10-09T18:00:00Z');
const inMinutes = (m: number) => new Date(NOW + m * 60_000).toISOString();

const valid: CreatePickInput = {
  category: 'food',
  center: { lat: 40.9126, lng: -73.1234 },
  radiusM: 3219,
  poolSize: 20,
  deadlineAt: inMinutes(60),
  closeThreshold: 100,
};

const fieldsOf = (input: unknown) => validateCreatePick(input, NOW).map((p) => p.field);

describe('validateCreatePick', () => {
  test('accepts a normal Pick, with or without a deadline', () => {
    expect(validateCreatePick(valid, NOW)).toEqual([]);
    expect(validateCreatePick({ ...valid, deadlineAt: null }, NOW)).toEqual([]);
  });

  test('rejects garbage bodies with every field listed', () => {
    expect(fieldsOf(null)).toEqual([
      'category',
      'center',
      'radiusM',
      'poolSize',
      'deadlineAt',
      'closeThreshold',
    ]);
  });

  test('category must be food or activities', () => {
    expect(fieldsOf({ ...valid, category: 'bars' })).toEqual(['category']);
  });

  test('center must be real coordinates', () => {
    expect(fieldsOf({ ...valid, center: { lat: 91, lng: 0 } })).toEqual(['center']);
    expect(fieldsOf({ ...valid, center: { lat: NaN, lng: 0 } })).toEqual(['center']);
    expect(fieldsOf({ ...valid, center: undefined })).toEqual(['center']);
  });

  test('radius matches the picks.radius_m check and must be whole meters', () => {
    expect(fieldsOf({ ...valid, radiusM: MAX_RADIUS_M })).toEqual([]);
    expect(fieldsOf({ ...valid, radiusM: MAX_RADIUS_M + 1 })).toEqual(['radiusM']);
    expect(fieldsOf({ ...valid, radiusM: 0 })).toEqual(['radiusM']);
    expect(fieldsOf({ ...valid, radiusM: 1000.5 })).toEqual(['radiusM']);
  });

  test('pool size stays between 5 and 30', () => {
    expect(fieldsOf({ ...valid, poolSize: 5 })).toEqual([]);
    expect(fieldsOf({ ...valid, poolSize: 4 })).toEqual(['poolSize']);
    expect(fieldsOf({ ...valid, poolSize: 31 })).toEqual(['poolSize']);
  });

  test('deadline needs at least 5 minutes and at most a week', () => {
    expect(fieldsOf({ ...valid, deadlineAt: inMinutes(4) })).toEqual(['deadlineAt']);
    expect(fieldsOf({ ...valid, deadlineAt: inMinutes(-10) })).toEqual(['deadlineAt']);
    expect(fieldsOf({ ...valid, deadlineAt: inMinutes(8 * 24 * 60) })).toEqual(['deadlineAt']);
    expect(fieldsOf({ ...valid, deadlineAt: 'tomorrow' })).toEqual(['deadlineAt']);
    expect(fieldsOf({ ...valid, deadlineAt: undefined })).toEqual(['deadlineAt']);
  });

  test('close threshold matches picks.close_threshold (1–100)', () => {
    expect(fieldsOf({ ...valid, closeThreshold: 1 })).toEqual([]);
    expect(fieldsOf({ ...valid, closeThreshold: 0 })).toEqual(['closeThreshold']);
    expect(fieldsOf({ ...valid, closeThreshold: 101 })).toEqual(['closeThreshold']);
  });
});

test('miles and meters round-trip', () => {
  expect(milesToMeters(2)).toBe(3219);
  expect(metersToMiles(milesToMeters(5))).toBeCloseTo(5, 3);
});
