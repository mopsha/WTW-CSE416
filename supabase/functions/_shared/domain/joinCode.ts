// Join codes (Razin): 6 characters from an alphabet without 0/O/1/I.
// Same rule as pick_join_codes in 0006_join_codes.sql; the app's input uses it too.

export const JOIN_CODE_LENGTH = 6;
export const JOIN_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const JOIN_CODE = /^[A-HJ-NP-Z2-9]{6}$/;

/** People type codes: ignore case and whitespace. */
export function normalizeJoinCode(input: string): string {
  return input.replace(/\s/g, '').toUpperCase();
}

/** The normalized code if it could be a join code, otherwise null. */
export function parseJoinCode(input: string): string | null {
  const code = normalizeJoinCode(input);
  return JOIN_CODE.test(code) ? code : null;
}
