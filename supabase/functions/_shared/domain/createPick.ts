// Create Pick input: the body of POST /picks (owner: Mike; server side: Alan).
// The app validates before sending and the API must validate again with the same
// function, so both sides agree on the limits. Limits mirror the picks table checks.

import { planProblem, type PlanOptions } from './customPlans.ts';
import { validFilters, type PlaceFilters } from './placeFilters.ts';
import type { LatLng } from './geo.ts';

export const PICK_CATEGORIES = ['food', 'activities', 'custom'] as const;
export type PickCategory = (typeof PICK_CATEGORIES)[number];

/** picks.radius_m: > 0 and <= 50 km. The app's slider stays well inside this. */
export const MIN_RADIUS_M = 200;
export const MAX_RADIUS_M = 50_000;

/** How many places go into the swipe deck. */
export const MIN_POOL_SIZE = 5;
export const MAX_POOL_SIZE = 30;
export const DEFAULT_POOL_SIZE = 20;

/** picks.close_threshold: percent of participants who must finish before swiping closes. */
export const MIN_CLOSE_THRESHOLD = 1;
export const MAX_CLOSE_THRESHOLD = 100;

/** A deadline must leave people time to swipe. */
export const MIN_DEADLINE_LEAD_MS = 5 * 60_000;
export const MAX_DEADLINE_LEAD_MS = 7 * 24 * 60 * 60_000;

export interface CreatePickInput extends PlaceFilters, PlanOptions {
  category: PickCategory;
  center: LatLng;
  radiusM: number;
  poolSize: number;
  /** ISO 8601, or null for no deadline (the host closes it, or the threshold does). */
  deadlineAt: string | null;
  closeThreshold: number;
}

export type CreatePickField = keyof CreatePickInput;

export interface CreatePickProblem {
  field: CreatePickField;
  message: string;
}

const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);
const isFiniteNumber = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/**
 * Checks a Create Pick body. Returns every problem (empty when valid) so the app can
 * show each one next to its field and the API can return 400 INVALID_INPUT.
 * `now` is injectable for tests.
 */
export function validateCreatePick(input: unknown, now: number = Date.now()): CreatePickProblem[] {
  const problems: CreatePickProblem[] = [];
  const add = (field: CreatePickField, message: string) => problems.push({ field, message });
  const body = (typeof input === 'object' && input !== null ? input : {}) as Record<
    string,
    unknown
  >;

  if (!PICK_CATEGORIES.includes(body.category as PickCategory)) {
    add('category', 'Choose food, activities or a custom plan.');
  }

  const center = body.center as Partial<LatLng> | undefined;
  if (
    typeof center !== 'object' ||
    center === null ||
    !isFiniteNumber(center.lat) ||
    !isFiniteNumber(center.lng) ||
    Math.abs(center.lat) > 90 ||
    Math.abs(center.lng) > 180
  ) {
    add('center', 'Drop a pin where you want to meet.');
  }

  if (!isInt(body.radiusM) || body.radiusM < MIN_RADIUS_M || body.radiusM > MAX_RADIUS_M) {
    add('radiusM', `Radius must be between ${MIN_RADIUS_M} m and ${MAX_RADIUS_M / 1000} km.`);
  }

  if (
    !isInt(body.poolSize) ||
    body.poolSize < (body.category === 'custom' ? 2 : MIN_POOL_SIZE) ||
    body.poolSize > MAX_POOL_SIZE
  ) {
    add(
      'poolSize',
      `Pool size must be between ${body.category === 'custom' ? 2 : MIN_POOL_SIZE} and ${MAX_POOL_SIZE} places.`,
    );
  }

  if (body.deadlineAt !== null) {
    const at = typeof body.deadlineAt === 'string' ? Date.parse(body.deadlineAt) : NaN;
    if (Number.isNaN(at)) add('deadlineAt', 'Deadline must be a date, or none.');
    else if (at - now < MIN_DEADLINE_LEAD_MS) add('deadlineAt', 'Give people at least 5 minutes.');
    else if (at - now > MAX_DEADLINE_LEAD_MS) add('deadlineAt', 'Deadline must be within a week.');
  }

  if (
    !isInt(body.closeThreshold) ||
    body.closeThreshold < MIN_CLOSE_THRESHOLD ||
    body.closeThreshold > MAX_CLOSE_THRESHOLD
  ) {
    add('closeThreshold', 'Close threshold must be between 1% and 100%.');
  }

  if (!validFilters(body as PlaceFilters))
    add('priceMax', 'Choose a price from 0 to 4 and a valid open-now filter.');
  const planError = planProblem(body);
  if (planError) add('customOptions', planError);
  if (
    Array.isArray(body.customOptions) &&
    isInt(body.poolSize) &&
    body.poolSize < body.customOptions.length
  )
    add('poolSize', 'Pool must fit all typed options.');
  return problems;
}

/** Miles ↔ meters for the radius slider (the app shows miles; the API stores meters). */
export const METERS_PER_MILE = 1609.344;
export const milesToMeters = (mi: number): number => Math.round(mi * METERS_PER_MILE);
export const metersToMiles = (m: number): number => m / METERS_PER_MILE;
