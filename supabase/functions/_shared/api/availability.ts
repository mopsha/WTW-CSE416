import { ApiError } from './errors.ts';
import type { Availability, AvailabilityResponse } from '../domain/availability.ts';
import { proposedTimeProblem } from '../domain/availability.ts';
import type { CandidateSnapshot } from './lifecycle.ts';
export interface AvailabilityStore {
  load(pickId: string, userId: string): Promise<Availability | null>;
  respond(
    pickId: string,
    userId: string,
    revision: number,
    response: AvailabilityResponse,
  ): Promise<void>;
  changeTime(pickId: string, userId: string, revision: number, proposedAt: string): Promise<void>;
  claim(
    pickId: string,
    userId: string,
  ): Promise<{ started: true; candidateCount: number } | { started: false; token: string }>;
  finish(
    pickId: string,
    userId: string,
    token: string,
    candidates: CandidateSnapshot[],
  ): Promise<void>;
  abort(pickId: string, userId: string, token: string): Promise<void>;
}
function parse(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new ApiError(400, 'INVALID_INPUT', 'Expected an availability object.');
  const value = body as Record<string, unknown>;
  if (
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 1 ||
    (value.revision as number) > 2147483647
  )
    throw new ApiError(400, 'INVALID_INPUT', 'A time revision is required.');
  if ('userId' in value)
    throw new ApiError(400, 'INVALID_INPUT', 'Respond only for your own account.');
  return value;
}
export async function respondAvailability(
  store: AvailabilityStore,
  pickId: string,
  userId: string,
  body: unknown,
) {
  const value = parse(body);
  if (!['yes', 'maybe', 'cant'].includes(value.response as string))
    throw new ApiError(400, 'INVALID_INPUT', 'Choose Yes, Maybe or Can’t.');
  await store.respond(
    pickId,
    userId,
    value.revision as number,
    value.response as AvailabilityResponse,
  );
  return { status: 'ok' as const };
}
export async function changeProposedTime(
  store: AvailabilityStore,
  pickId: string,
  userId: string,
  body: unknown,
) {
  const value = parse(body);
  const error = proposedTimeProblem(value.proposedAt);
  if (error) throw new ApiError(400, 'INVALID_INPUT', error);
  await store.changeTime(
    pickId,
    userId,
    value.revision as number,
    new Date(value.proposedAt as string).toISOString(),
  );
  return { status: 'ok' as const };
}
