import { ApiError } from '@/lib/api';
import { BAD_CODE_MESSAGE, joinErrorMessage } from '@/lib/join';

test('join errors become plain-language messages', () => {
  expect(joinErrorMessage(new ApiError('JOIN_CODE_NOT_FOUND', 'x', 404))).toMatch(/No open Pick/);
  expect(joinErrorMessage(new ApiError('PICK_CLOSED', 'x', 409))).toMatch(/already been decided/);
  expect(joinErrorMessage(new ApiError('INVALID_INPUT', 'x', 400))).toBe(BAD_CODE_MESSAGE);
  expect(joinErrorMessage(new ApiError('network_error', 'Can’t reach WTW.', 0))).toBe(
    'Can’t reach WTW.',
  );
});
