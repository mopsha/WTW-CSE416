import { bodyTasteType, recordGoogleTaste, surveyType } from '@shared/api/tasteSignals.ts';

test('only survey place types are accepted', () => {
  expect(surveyType('sushi_restaurant')).toBe('sushi_restaurant');
  expect(surveyType('bowling_alley')).toBe('bowling_alley');
  expect(surveyType('casino')).toBeNull();
  expect(surveyType(7)).toBeNull();
  expect(bodyTasteType({ placeId: 'x', tasteType: 'cafe' })).toBe('cafe');
  expect(bodyTasteType([])).toBeUndefined();
});

test('records a valid signal and never throws', async () => {
  const store = { recordGoogleTaste: jest.fn().mockResolvedValue(undefined) };
  await expect(recordGoogleTaste(store, 'u', 'p', 'g', 'swipe', 'cafe')).resolves.toBe(true);
  expect(store.recordGoogleTaste).toHaveBeenCalledWith('u', 'p', 'g', 'swipe', 'cafe');

  store.recordGoogleTaste.mockRejectedValue(new Error('db down'));
  await expect(recordGoogleTaste(store, 'u', 'p', 'g', 'vote', 'cafe')).resolves.toBe(false);
});

test('skips old apps, unknown types and stores without learning', async () => {
  const store = { recordGoogleTaste: jest.fn() };
  await recordGoogleTaste(store, 'u', 'p', 'g', 'swipe', undefined);
  await recordGoogleTaste(store, 'u', 'p', 'g', 'swipe', 'casino');
  await recordGoogleTaste(store, 'u', 'p', '', 'swipe', 'cafe');
  expect(store.recordGoogleTaste).not.toHaveBeenCalled();
  await expect(recordGoogleTaste({}, 'u', 'p', 'g', 'swipe', 'cafe')).resolves.toBe(false);
});
