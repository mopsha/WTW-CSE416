import { createApp } from './app.ts';
import { getUser } from './auth.ts';
import { createProgressStore } from './progressStore.ts';
import { createStore } from './store.ts';
import { createLifecycleStore } from './lifecycleStore.ts';
import { createClosingStore } from './closingStore.ts';
import { createJoinStore } from './joinStore.ts';
import { createFriendsStore } from './friendsStore.ts';
import { createProfileStore } from './profileStore.ts';
import { createSweepStore } from './sweepStore.ts';
import { createNotifyStore } from './notifyStore.ts';
import { createNotifier } from '../_shared/api/notify.ts';
import { refreshCandidateHours } from './hours.ts';
import { createPoolBuilder } from '../_shared/places/pool.ts';
import { MockProvider } from '../_shared/places/MockProvider.ts';

// MockProvider until Josh's PLACES_PROVIDER=google|mock switch (Week 2) lands;
// createPoolBuilder itself is provider-agnostic, so swapping providers needs
// no change here.
const poolBuilder = createPoolBuilder(new MockProvider());

// One notifier for every Pick event; inbox rows + Expo push (no Expo access token needed
// unless "enhanced push security" is turned on in the Expo project).
const notifyStore = createNotifyStore();
const notifier = createNotifier(notifyStore, (url, init) => fetch(url, init));

// Supabase forwards /functions/v1/api/health to the runtime as /api/health.
const app = createApp(
  {
    getUser,
    store: createStore(),
    progressStore: createProgressStore(),
    lifecycleStore: { ...createLifecycleStore(), notifier },
    closingStore: { ...createClosingStore(), notifier },
    sweepStore: createSweepStore(),
    notifyStore,
    cronSecret: Deno.env.get('CRON_SECRET'),
    poolBuilder,
    joinStore: createJoinStore(),
    friendsStore: createFriendsStore(),
    profileStore: createProfileStore(),
    refreshHours: refreshCandidateHours,
  },
  '/api',
);
Deno.serve(app.fetch);
