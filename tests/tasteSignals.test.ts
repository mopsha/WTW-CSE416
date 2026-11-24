/** @jest-environment node */
import {
  bodyTaste,
  createTasteSigner,
  proveTaste,
  recordGoogleTaste,
  surveyType,
  tasteProofMessage,
} from '@shared/api/tasteSignals.ts';

const sign = createTasteSigner('test-only-server-secret');
const store = () => ({
  signTaste: sign,
  recordGoogleTaste: jest.fn().mockResolvedValue(undefined),
});

test('only survey place types are accepted', () => {
  expect(surveyType('sushi_restaurant')).toBe('sushi_restaurant');
  expect(surveyType('casino')).toBeNull();
  expect(surveyType(7)).toBeNull();
  expect(bodyTaste({ placeId: 'x', tasteType: 'cafe', tasteProof: 'p' })).toEqual({
    type: 'cafe',
    proof: 'p',
  });
  expect(bodyTaste([])).toEqual({ type: undefined, proof: undefined });
});

test('signatures are stable, URL-safe, and bound to user, Pick, place and type', async () => {
  const a = await sign(tasteProofMessage('u', 'p', 'g', 'cafe'));
  expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(await sign(tasteProofMessage('u', 'p', 'g', 'cafe'))).toBe(a);
  for (const other of [
    tasteProofMessage('someone-else', 'p', 'g', 'cafe'),
    tasteProofMessage('u', 'other-pick', 'g', 'cafe'),
    tasteProofMessage('u', 'p', 'other-place', 'cafe'),
    tasteProofMessage('u', 'p', 'g', 'bowling_alley'),
  ])
    expect(await sign(other)).not.toBe(a);
  const otherKey = createTasteSigner('a-different-secret');
  expect(await otherKey(tasteProofMessage('u', 'p', 'g', 'cafe'))).not.toBe(a);
});

test("a swipe or vote teaches only with the server's proof for exactly that card", async () => {
  const s = store();
  const proof = await proveTaste(s, 'u', 'p', 'g', 'sushi_restaurant');
  await expect(
    recordGoogleTaste(s, 'u', 'p', 'g', 'swipe', 'sushi_restaurant', proof),
  ).resolves.toBe(true);
  expect(s.recordGoogleTaste).toHaveBeenCalledWith('u', 'p', 'g', 'swipe', 'sushi_restaurant');
  s.recordGoogleTaste.mockClear();

  // Josh's case: a real proof, but a different type claimed (bowling for a food place).
  await recordGoogleTaste(s, 'u', 'p', 'g', 'vote', 'bowling_alley', proof);
  // Someone else's proof, no proof, or a forged one.
  await recordGoogleTaste(s, 'other', 'p', 'g', 'swipe', 'sushi_restaurant', proof);
  await recordGoogleTaste(s, 'u', 'p', 'g', 'swipe', 'sushi_restaurant', undefined);
  await recordGoogleTaste(s, 'u', 'p', 'g', 'swipe', 'sushi_restaurant', 'x'.repeat(43));
  expect(s.recordGoogleTaste).not.toHaveBeenCalled();
});

test("winners use the server's own live type, so they need no proof", async () => {
  await expect(recordGoogleTaste(store(), 'u', 'p', 'g', 'winner', 'cafe')).resolves.toBe(true);
});

test('never throws, and does nothing without a signer or for unknown types', async () => {
  const failing = { signTaste: sign, recordGoogleTaste: jest.fn().mockRejectedValue(new Error()) };
  await expect(recordGoogleTaste(failing, 'u', 'p', 'g', 'winner', 'cafe')).resolves.toBe(false);
  const noSigner = { recordGoogleTaste: jest.fn() };
  await recordGoogleTaste(noSigner, 'u', 'p', 'g', 'swipe', 'cafe', 'anything');
  expect(noSigner.recordGoogleTaste).not.toHaveBeenCalled();
  const s = store();
  await recordGoogleTaste(s, 'u', 'p', 'g', 'winner', 'casino');
  expect(s.recordGoogleTaste).not.toHaveBeenCalled();
  expect(await proveTaste({}, 'u', 'p', 'g', 'cafe')).toBeNull();
});
