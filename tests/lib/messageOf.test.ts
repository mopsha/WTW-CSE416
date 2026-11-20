import { ApiError } from '@/lib/api';
import { messageOf } from '@/lib/errors';

test('developer-facing server messages become plain sentences', () => {
  expect(messageOf(new ApiError('INVALID_PICK_STATE', 'Pick must be draft to start', 409))).toBe(
    'This Pick has already moved on. Go back and open it again.',
  );
  expect(messageOf(new ApiError('http_502', 'Bad gateway', 502))).toBe(
    'WTW hit a snag. Try again in a moment.',
  );
});

test('messages already written for people pass through', () => {
  expect(
    messageOf(
      new ApiError(
        'NO_CANDIDATES',
        'No places found within 2 mi. Cancel this Pick and try another area.',
        409,
      ),
    ),
  ).toBe('No places found within 2 mi. Cancel this Pick and try another area.');
  expect(
    messageOf(new ApiError('network_error', 'Can’t reach WTW. Check your connection.', 0)),
  ).toBe('Can’t reach WTW. Check your connection.');
  expect(messageOf('nope')).toBe('Something went wrong. Please try again.');
});
