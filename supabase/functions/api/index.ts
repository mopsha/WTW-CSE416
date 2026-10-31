import { createApp } from './app.ts';
import { getUser } from './auth.ts';
import { createProgressStore } from './progressStore.ts';
import { createStore } from './store.ts';
import { createLifecycleStore } from './lifecycleStore.ts';
import { createClosingStore } from './closingStore.ts';
import { createJoinStore } from './joinStore.ts';
import { createGroupsStore } from './groupsStore.ts';
import { createSweepStore } from './sweepStore.ts';
import { refreshCandidateHours } from './hours.ts';
import { createPoolBuilder } from '../_shared/places/pool.ts';
import { MockProvider } from '../_shared/places/MockProvider.ts';

// MockProvider until Josh's PLACES_PROVIDER=google|mock switch (Week 2) lands;
// createPoolBuilder itself is provider-agnostic, so swapping providers needs
// no change here.
const poolBuilder = createPoolBuilder(new MockProvider());

// Supabase forwards /functions/v1/api/health to the runtime as /api/health.
const app = createApp(
  {
    getUser,
    store: createStore(),
    progressStore: createProgressStore(),
    lifecycleStore: createLifecycleStore(),
    closingStore: createClosingStore(),
    sweepStore: createSweepStore(),
    cronSecret: Deno.env.get('CRON_SECRET'),
    poolBuilder,
    joinStore: createJoinStore(),
    groupsStore: createGroupsStore(),
    refreshHours: refreshCandidateHours,
  },
  '/api',
);
Deno.serve(app.fetch);
