import { GoogleProvider, type HttpClient } from './GoogleProvider.ts';
import { MockProvider } from './MockProvider.ts';
import { createPoolBuilder, type PoolBuilder, type PoolOptions } from './pool.ts';

export type ReadEnvironment = (name: string) => string | undefined;
export function providerMode(value: string | undefined): 'google' | 'mock' {
  if (value === undefined) return 'mock';
  if (value === 'google' || value === 'mock') return value;
  throw new Error('PLACES_PROVIDER must be google or mock');
}

/** Read on each build, not module initialization. Caller supplies server-only env access. */
export function createConfiguredPoolBuilder(
  read: ReadEnvironment,
  options: Omit<PoolOptions, 'provider' | 'fallback'> & { http?: HttpClient } = {},
): PoolBuilder {
  return {
    async buildPool(request) {
      const mode = providerMode(read('PLACES_PROVIDER'));
      const mock = new MockProvider();
      // Missing credentials in explicitly selected Google mode are configuration errors,
      // not silently successful mock mode. Runtime Google failures still fall back.
      const provider =
        mode === 'google'
          ? new GoogleProvider(read('GOOGLE_PLACES_API_KEY') ?? '', options.http, options.now)
          : mock;
      return createPoolBuilder(provider, {
        ...options,
        provider: mode,
        fallback: mode === 'google' ? mock : undefined,
      }).buildPool(request);
    },
  };
}
