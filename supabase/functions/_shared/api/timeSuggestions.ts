import { ApiError } from './errors.ts';
import { parsePlanTime } from './plans.ts';
import type { Notifier } from './notify.ts';

export interface TimeSuggestion {
  id: string;
  proposerId: string;
  displayName: string | null;
  planAt: string;
  revision: number;
  status: 'pending' | 'accepted' | 'withdrawn' | 'superseded' | 'expired';
}
export interface TimeSuggestions {
  revision: number;
  planAt: string;
  isHost: boolean;
  suggestions: TimeSuggestion[];
}
export interface TimeSuggestionMutation {
  id: string;
  notifyUserIds?: string[];
}
export interface TimeSuggestionsStore {
  load(pickId: string, viewer: string): Promise<TimeSuggestions>;
  suggest(
    pickId: string,
    viewer: string,
    revision: number,
    planAt: string,
  ): Promise<TimeSuggestionMutation>;
  act(
    pickId: string,
    viewer: string,
    id: string,
    revision: number,
    action: 'accept' | 'withdraw',
  ): Promise<TimeSuggestionMutation>;
  notifier?: Notifier;
}
function bodyObject(body: unknown, keys: string[]) {
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).some((k) => !keys.includes(k))
  )
    throw new ApiError(400, 'INVALID_INPUT', 'Invalid time suggestion');
  return body as Record<string, unknown>;
}
function revision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 2147483647)
    throw new ApiError(400, 'INVALID_INPUT', 'Refresh the schedule before trying again');
  return value;
}
export async function suggestTime(
  store: TimeSuggestionsStore,
  pickId: string,
  viewer: string,
  body: unknown,
) {
  const input = bodyObject(body, ['revision', 'planAt']);
  if (typeof input.planAt !== 'string' || !/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(input.planAt))
    throw new ApiError(400, 'INVALID_INPUT', 'Send a date with its timezone');
  const result = await store.suggest(
    pickId,
    viewer,
    revision(input.revision),
    parsePlanTime(input),
  );
  await store
    .notifier?.(result.notifyUserIds ?? [], 'time_suggested', pickId, {
      timeSuggestionId: result.id,
    })
    .catch(() => {});
  return { id: result.id };
}
export async function actOnTimeSuggestion(
  store: TimeSuggestionsStore,
  pickId: string,
  viewer: string,
  id: string,
  action: 'accept' | 'withdraw',
  body: unknown,
) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
    throw new ApiError(400, 'INVALID_INPUT', 'Invalid suggestion');
  const input = bodyObject(body, ['revision']);
  const result = await store.act(pickId, viewer, id, revision(input.revision), action);
  if (action === 'accept')
    await store
      .notifier?.(result.notifyUserIds ?? [], 'plan_time_set', pickId, {
        timeSuggestionId: result.id,
        reconfirmRsvp: true,
      })
      .catch(() => {});
  return { id: result.id };
}
