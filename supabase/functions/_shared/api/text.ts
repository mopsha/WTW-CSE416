// Every route that stores text other people see calls requireCleanText before writing it
// (Razin, M4). Owners: POST /me display names (#22), group create/rename (#30), custom
// options and hang posts (Josh, #27). See docs/api-integration.md ("Text filter").
import { ApiError } from './errors.ts';
import { textFilter } from '../domain/textFilter.ts';

export { textFilter } from '../domain/textFilter.ts';

/**
 * Throws 400 TEXT_NOT_ALLOWED if `text` fails the word filter. `field` names it in the
 * message ("That group name isn't allowed"); the matched word is never echoed back.
 */
export function requireCleanText(text: string, field: string): void {
  if (!textFilter(text).ok) {
    throw new ApiError(
      400,
      'TEXT_NOT_ALLOWED',
      `That ${field} isn’t allowed. Try different words.`,
    );
  }
}
