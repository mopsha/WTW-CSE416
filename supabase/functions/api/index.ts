import { createApp } from './app.ts';
import { getUser } from './auth.ts';
import { createStore } from './store.ts';

// Supabase forwards /functions/v1/api/health to the runtime as /api/health.
const app = createApp({ getUser, store: createStore() }, '/api');
Deno.serve(app.fetch);
