// EXPO_PUBLIC_* vars are inlined at build time, so they must be read as literal
// `process.env.EXPO_PUBLIC_X` expressions (no destructuring or dynamic keys).

/** EXPO_PUBLIC_USE_MOCK=1 runs every screen against local fixtures (no backend needed). */
export const USE_MOCK = process.env.EXPO_PUBLIC_USE_MOCK === '1';

export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

/** Our single Edge Function. Every write goes through it. */
export const API_BASE_URL = `${SUPABASE_URL}/functions/v1/api`;

/** Mock mode only: fraction (0–1) of API writes that fail, to exercise retry UI. */
export const MOCK_FAIL_RATE = Number(process.env.EXPO_PUBLIC_MOCK_FAIL_RATE ?? '0') || 0;
