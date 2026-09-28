// Typed client for our Edge Function (`${EXPO_PUBLIC_SUPABASE_URL}/functions/v1/api`).
// Every write goes through here with the user's access token; reads use Supabase + RLS.
import { getAccessToken } from './auth';
import { API_BASE_URL, USE_MOCK } from './config';
import { MOCK_API_BASE_URL, mockFetch } from './mock/api';
import type { PreferenceValue } from './types';

/** Error codes the app itself produces; server codes pass through as-is. */
export type ClientErrorCode = 'network_error' | 'not_signed_in' | `http_${number}`;

export class ApiError extends Error {
  override readonly name = 'ApiError';
  constructor(
    /** Server `error.code`, or a ClientErrorCode. */
    readonly code: string,
    message: string,
    /** HTTP status; 0 when the request never got a response. */
    readonly status: number,
  ) {
    super(message);
  }
}

/** Reads the API's `{ error: { code, message } }` body. Returns null for any other shape. */
export function parseErrorBody(body: unknown): { code: string; message: string } | null {
  if (typeof body !== 'object' || body === null || !('error' in body)) return null;
  const { error } = body;
  if (typeof error !== 'object' || error === null) return null;
  const code = 'code' in error ? error.code : undefined;
  const message = 'message' in error ? error.message : undefined;
  if (typeof code !== 'string' || typeof message !== 'string') return null;
  return { code, message };
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface ApiClientOptions {
  baseUrl: string;
  getAccessToken: () => Promise<string | null>;
  fetch: FetchLike;
}

export interface OkResponse {
  ok: true;
}

export function createApiClient({ baseUrl, getAccessToken, fetch }: ApiClientOptions) {
  async function request<T>(
    method: 'GET' | 'POST',
    path: string,
    { body, auth = true }: { body?: unknown; auth?: boolean } = {},
  ): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (auth) {
      const token = await getAccessToken();
      if (!token) throw new ApiError('not_signed_in', 'Please sign in again.', 401);
      headers.Authorization = `Bearer ${token}`;
    }
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    let res: Response;
    try {
      res = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError('network_error', 'Can’t reach WTW. Check your connection.', 0);
    }

    const text = await res.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }

    if (!res.ok) {
      const err = parseErrorBody(json);
      throw new ApiError(
        err?.code ?? `http_${res.status}`,
        err?.message ?? `Something went wrong (${res.status}).`,
        res.status,
      );
    }
    return json as T;
  }

  const pickPath = (pickId: string) => `/picks/${encodeURIComponent(pickId)}`;

  return {
    health: () => request<unknown>('GET', '/health', { auth: false }),
    submitSwipe: (pickId: string, placeId: string, value: PreferenceValue) =>
      request<OkResponse>('POST', `${pickPath(pickId)}/swipes`, { body: { placeId, value } }),
    /** Ranks the Pick. Read the result from ranking_results / picks (see queries.ts). */
    rankPick: (pickId: string) => request<unknown>('POST', `${pickPath(pickId)}/rank`),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

export const api: ApiClient = createApiClient(
  USE_MOCK
    ? { baseUrl: MOCK_API_BASE_URL, getAccessToken, fetch: mockFetch }
    : { baseUrl: API_BASE_URL, getAccessToken, fetch: (url, init) => fetch(url, init) },
);
