import { createPastMovesStore } from './pastMovesStore.ts';
import { createAvatarStore } from './avatarStore.ts';
import { createDirectChatStore } from './directChatStore.ts';
import { createGroupChatStore } from './groupChatStore.ts';
import { createUserProfilesStore } from './userProfilesStore.ts';
import { createGroupInvitationsStore } from './groupInvitationsStore.ts';
import { createGroupIdeasStore } from './groupIdeasStore.ts';
import { createHangStore } from './hangStore.ts';
import { createApp } from './app.ts';
import { getUser } from './auth.ts';
import { createProgressStore } from './progressStore.ts';
import { createStore } from './store.ts';
import { createLifecycleStore } from './lifecycleStore.ts';
import { createClosingStore } from './closingStore.ts';
import { createJoinStore } from './joinStore.ts';
import { createFriendsStore } from './friendsStore.ts';
import { createProfileStore } from './profileStore.ts';
import { createGroupsStore } from './groupsStore.ts';
import { createSafetyStore } from './safetyStore.ts';
import { createInviteStore } from './inviteStore.ts';
import { createAccountStore, retryPendingAccountDeletions } from './accountStore.ts';
import { createSweepStore } from './sweepStore.ts';
import { createNotifyStore } from './notifyStore.ts';
import { createPlansStore } from './plansStore.ts';
import { createNotifier } from '../_shared/api/notify.ts';
import { refreshCandidateHours } from './hours.ts';
import { createPoolBuilder } from '../_shared/places/pool.ts';
import { MockProvider } from '../_shared/places/MockProvider.ts';
import { placesPoolBuilder, resolveDiscoverPhoto } from './places.ts';
import { createDiscoverStore } from './discoverStore.ts';
import { checkUserLimit } from './limits.ts';
import { createPlaceCache, createCacheCleanupStore } from './placeCacheStore.ts';

// Discover uses configured Google/mock selection with a shared atomic HTTP budget.
// Group Picks still require persistable snapshots and frozen ranking coordinates;
// see docs/m4-josh-phase1.md for the remaining Google lifecycle dependency.
const poolBuilder = createPoolBuilder(new MockProvider(), { cache: createPlaceCache() });

// One notifier for every Pick event; inbox rows + Expo push (no Expo access token needed
// unless "enhanced push security" is turned on in the Expo project).
const notifyStore = createNotifyStore();
const notifier = createNotifier(notifyStore, (url, init) => fetch(url, init));

// Supabase forwards /functions/v1/api/health to the runtime as /api/health.
const app = createApp(
  {
    getUser,
    hangStore: createHangStore(notifier),
    store: createStore(),
    progressStore: createProgressStore(),
    lifecycleStore: { ...createLifecycleStore(), notifier },
    closingStore: { ...createClosingStore(), notifier },
    sweepStore: createSweepStore(),
    cacheCleanupStore: createCacheCleanupStore(),
    notifyStore,
    plansStore: { ...createPlansStore(), notifier },
    pastMovesStore: createPastMovesStore(),
    cronSecret: Deno.env.get('CRON_SECRET'),
    poolBuilder,
    discoverPool: placesPoolBuilder,
    discoverPhoto: resolveDiscoverPhoto,
    discoverStore: createDiscoverStore(),
    checkLimit: checkUserLimit,
    joinStore: createJoinStore(),
    friendsStore: createFriendsStore(),
    profileStore: createProfileStore(),
    userProfilesStore: createUserProfilesStore(),
    groupsStore: createGroupsStore(),
    groupInvitationsStore: createGroupInvitationsStore(),
    groupIdeasStore: createGroupIdeasStore(),
    groupChatStore: createGroupChatStore(),
    directChatStore: createDirectChatStore(),
    safetyStore: createSafetyStore(),
    inviteStore: createInviteStore(),
    accountStore: createAccountStore(),
    retryAccountDeletions: retryPendingAccountDeletions,
    avatarStore: createAvatarStore(),
    refreshHours: refreshCandidateHours,
  },
  '/api',
);
Deno.serve(app.fetch);
