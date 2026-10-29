import {
  customOptionsProblem,
  makeCustomOptions,
  CUSTOM_TEMPLATES,
} from '@shared/domain/customPlans.ts';
import { parseCreatePick } from '@shared/api/lifecycle.ts';
import { priorityCandidates } from '@shared/domain/candidatePriority.ts';
const input = {
  category: 'custom',
  center: { lat: 40, lng: -73 },
  radiusM: 1000,
  customOptions: [
    { name: 'Game night' },
    { name: 'Basketball' },
    { name: 'Cookout' },
    { name: 'Movie night' },
  ],
};
test('four typed options accepted, immutable UUID identities and creator, location provenance explicit', () => {
  expect(parseCreatePick(input).poolSize).toBe(4);
  let index = 0;
  const options = makeCustomOptions(
    input.customOptions,
    'host',
    input.center,
    () => `00000000-0000-4000-8000-${String(++index).padStart(12, '0')}`,
  );
  expect(new Set(options.map((p) => p.placeId)).size).toBe(4);
  expect(
    options.every(
      (p) =>
        p.placeId.startsWith('custom:') &&
        p.createdBy === 'host' &&
        p.provider === 'custom' &&
        p.locationProvided === false,
    ),
  ).toBe(true);
  expect(options[0]).toMatchObject({ lat: 40, lng: -73 });
  expect(CUSTOM_TEMPLATES).toHaveLength(6);
});
const invalidCases: unknown[] = [
  [],
  [{ name: 'one' }],
  Array.from({ length: 21 }, () => ({ name: 'x' })),
  [{ name: '' }, { name: 'x' }],
  [{ name: 'x'.repeat(61) }, { name: 'y' }],
  [{ name: 'x', note: 'n'.repeat(201) }, { name: 'y' }],
  [{ name: 'x', lat: 40 }, { name: 'y' }],
  [{ name: 'x', lat: 91, lng: 0 }, { name: 'y' }],
];
test.each(invalidCases.map((options) => ({ options })))(
  'invalid options rejected: %j',
  ({ options }) => {
    expect(customOptionsProblem(options)).not.toBeNull();
    expect(() => parseCreatePick({ ...input, customOptions: options })).toThrow();
  },
);
test('boundary lengths, notes and valid coordinates are accepted', () => {
  expect(
    customOptionsProblem([
      { name: 'a'.repeat(60), note: 'n'.repeat(200), lat: 90, lng: -180 },
      { name: 'b', note: '' },
    ]),
  ).toBeNull();
});
test('saved priority keeps first representation, deduplicates and bounds the pool', () => {
  const saved = [
    { placeId: 'b', name: 'saved' },
    { placeId: 'b', name: 'duplicate' },
    { placeId: 'a', name: 'saved a' },
  ];
  expect(
    priorityCandidates(
      saved,
      [
        { placeId: 'b', name: 'google' },
        { placeId: 'c', name: 'cache' },
      ],
      3,
    ),
  ).toEqual([saved[0], saved[2], { placeId: 'c', name: 'cache' }]);
});
