import type { HttpClient } from './GoogleProvider.ts';

export class ProviderCapError extends Error {
  constructor() {
    super('Daily provider cap reached');
  }
}

/** Reserve atomically before every billable HTTP attempt, including failed calls. */
export function budgetedHttp(
  reserve: () => Promise<boolean>,
  http: HttpClient = fetch,
): HttpClient {
  return async (url, init) => {
    if (!(await reserve())) throw new ProviderCapError();
    return http(url, init);
  };
}
