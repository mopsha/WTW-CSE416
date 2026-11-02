import { errorResponse } from '@shared/api/errors.ts';
import { requireCleanText } from '@shared/api/text.ts';

test('clean text passes', () => {
  expect(() => requireCleanText('Friday boba crew', 'group name')).not.toThrow();
});

test('blocked text is a 400 TEXT_NOT_ALLOWED that names the field, not the word', () => {
  let error: unknown;
  try {
    requireCleanText('sh1t crew', 'group name');
  } catch (e) {
    error = e;
  }
  const response = errorResponse(error);
  expect(response.status).toBe(400);
  expect(response.body.error.code).toBe('TEXT_NOT_ALLOWED');
  expect(response.body.error.message).toContain('group name');
  expect(response.body.error.message).not.toMatch(/sh1t|shit/i);
});
