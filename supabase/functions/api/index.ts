import { createApp } from './app.ts';
import { getUser } from './auth.ts';
import { createProgressStore } from './progressStore.ts';
import { createStore } from './store.ts';

// Supabase forwards /functions/v1/api/health to the runtime as /api/health.
const app = createApp(
  { getUser, store: createStore(), progressStore: createProgressStore() },
  '/api',
);
Deno.serve(app.fetch);
