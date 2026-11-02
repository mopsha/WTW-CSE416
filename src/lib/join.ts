// Joining a Pick by code (Razin): the friendly words for each server answer. The code rules
// themselves are shared with the API (@shared/domain/joinCode.ts).
import { ApiError } from './api';
import { messageOf } from './errors';

export { JOIN_CODE_LENGTH, normalizeJoinCode, parseJoinCode } from '@shared/domain/joinCode.ts';

export const BAD_CODE_MESSAGE = 'Codes are 6 letters and numbers, like K7P2QX.';
const TOO_MANY_TRIES = 'Too many tries. Wait a bit, then try again.';
export const BAD_INVITE_MESSAGE =
  'That invite link doesn’t work any more. Ask whoever sent it for a new one.';

/** What to tell someone whose invite link didn't work. */
export function inviteErrorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'INVITE_NOT_FOUND') return BAD_INVITE_MESSAGE;
    if (e.code === 'RATE_LIMITED') return TOO_MANY_TRIES;
  }
  return messageOf(e);
}

/** What to tell someone whose join didn't work. */
export function joinErrorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    // One answer for unknown, expired, closed, locked and full: the server never says which.
    if (e.code === 'JOIN_CODE_NOT_FOUND') {
      return 'That code doesn’t open a Pick right now. Check it, or ask the host for a new one.';
    }
    if (e.code === 'RATE_LIMITED') return TOO_MANY_TRIES;
    if (e.code === 'INVALID_INPUT') return BAD_CODE_MESSAGE;
  }
  return messageOf(e);
}
