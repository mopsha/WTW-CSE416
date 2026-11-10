import { ApiError } from './errors.ts';

export interface Birthday {
  month: number;
  day: number;
}
export const BIRTHDAY_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;
export const BIRTHDAY_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/** Recurring month/day only. No timestamp, birth year or calendar-year anchor. */
export function parseBirthday(value: unknown): Birthday | null {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ApiError(400, 'INVALID_BIRTHDAY', 'Choose a birthday month and day');
  const b = value as Record<string, unknown>;
  if (
    Object.keys(b).some((key) => key !== 'month' && key !== 'day') ||
    typeof b.month !== 'number' ||
    !Number.isInteger(b.month) ||
    b.month < 1 ||
    b.month > 12 ||
    typeof b.day !== 'number' ||
    !Number.isInteger(b.day) ||
    b.day < 1 ||
    b.day > BIRTHDAY_DAYS[b.month - 1]!
  )
    throw new ApiError(400, 'INVALID_BIRTHDAY', 'Choose a valid birthday month and day');
  return { month: b.month, day: b.day };
}
export function sameBirthday(a?: Birthday | null, b?: Birthday | null): boolean {
  return (a?.month ?? null) === (b?.month ?? null) && (a?.day ?? null) === (b?.day ?? null);
}
export function birthdayLabel(birthday: Birthday): string {
  return `${BIRTHDAY_MONTHS[birthday.month - 1]} ${birthday.day}`;
}
