import { ApiError } from '@/lib/api';
import {
  BAD_CODE_MESSAGE,
  BAD_INVITE_MESSAGE,
  inviteErrorMessage,
  joinErrorMessage,
} from '@/lib/join';

test('join errors become plain-language messages', () => {
  expect(joinErrorMessage(new ApiError('JOIN_CODE_NOT_FOUND', 'x', 404))).toMatch(
    /doesn’t open a Pick/,
  );
  expect(joinErrorMessage(new ApiError('RATE_LIMITED', 'x', 429))).toMatch(/Too many tries/);
  expect(joinErrorMessage(new ApiError('INVALID_INPUT', 'x', 400))).toBe(BAD_CODE_MESSAGE);
  expect(joinErrorMessage(new ApiError('network_error', 'Can’t reach WTW.', 0))).toBe(
    'Can’t reach WTW.',
  );
});

test('invite errors become plain-language messages', () => {
  expect(inviteErrorMessage(new ApiError('INVITE_NOT_FOUND', 'x', 404))).toBe(BAD_INVITE_MESSAGE);
  expect(inviteErrorMessage(new ApiError('RATE_LIMITED', 'x', 429))).toMatch(/Too many tries/);
});
