// Joining a Pick by code (Razin): the friendly words for each server answer. The code rules
// themselves are shared with the API (@shared/domain/joinCode.ts).
import { ApiError } from './api';
import { messageOf } from './errors';

export { JOIN_CODE_LENGTH, normalizeJoinCode, parseJoinCode } from '@shared/domain/joinCode.ts';

export const BAD_CODE_MESSAGE = 'Codes are 6 letters and numbers, like K7P2QX.';

/** What to tell someone whose join didn't work. */
export function joinErrorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'JOIN_CODE_NOT_FOUND') {
      return 'No open Pick has that code. Check it, or ask for a new one.';
    }
    if (e.code === 'PICK_CLOSED') return 'That Pick has already been decided or canceled.';
    if (e.code === 'INVALID_INPUT') return BAD_CODE_MESSAGE;
  }
  return messageOf(e);
}
