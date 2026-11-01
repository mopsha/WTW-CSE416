import { cleanupCache, type CacheCleanupStore } from '../_shared/api/cacheCleanup.ts';
import { parseHang, respondHang, hangPick, type HangStore } from '../_shared/api/hang.ts';
import { discover, parseDiscover } from '../_shared/api/discover.ts';
import type { DiscoverPreferences } from '../_shared/domain/discoverScore.ts';
import { parseCreatePick } from '../_shared/api/lifecycle.ts';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { ApiError, errorResponse } from '../_shared/api/errors.ts';
import { swipe, type HeartbeatStore } from '../_shared/api/heartbeat.ts';
import { getProgress, type ProgressStore } from '../_shared/api/progress.ts';
import {
  cancelPick,
  getPick,
  refreshPick,
  startPick,
  type LifecycleStore,
} from '../_shared/api/lifecycle.ts';
import { closePick, type ClosingStore } from '../_shared/api/closing.ts';
import { castVote, closeVote, type VotingStore } from '../_shared/api/voting.ts';
import type { PoolBuilder } from '../_shared/places/pool.ts';
import { joinPick, type JoinStore } from '../_shared/api/join.ts';
import { authorizeSweep, sweepDeadlines, type SweepStore } from '../_shared/api/sweep.ts';
import {
  acceptFriend,
  listFriends,
  removeFriend,
  type FriendsStore,
} from '../_shared/api/friends.ts';
import {
  listNotifications,
  markNotificationRead,
  registerPushToken,
  unregisterPushToken,
  type NotifyStore,
} from '../_shared/api/notify.ts';
import { getMe, updateMe, updatePreferences, type ProfileStore } from '../_shared/api/profile.ts';
import {
  addGroupMembers,
  createGroup,
  createPickMaybeForGroup,
  deleteGroup,
  inviteToPick,
  leaveGroup,
  removeGroupMember,
  renameGroup,
  type GroupsStore,
} from '../_shared/api/groups.ts';
import {
  getHistory,
  getPlan,
  getReasons,
  pickAgain,
  recordOutcome,
  rsvp,
  setPlanTime,
  type PlansStore,
} from '../_shared/api/plans.ts';
import {
  blockUser,
  createReport,
  setLobbyLocked,
  unblockUser,
  type SafetyStore,
} from '../_shared/api/safety.ts';
import {
  acceptInvite,
  createInvite,
  revokeInvite,
  type InviteStore,
} from '../_shared/api/invites.ts';
import { deleteAccount, type AccountStore } from '../_shared/api/account.ts';
import { requestFriendSafely } from '../_shared/api/friendRequests.ts';

async function readJsonBody(c: { req: { text(): Promise<string> } }): Promise<unknown> {
  const raw = await c.req.text();
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'Request body must be valid JSON');
  }
}

export function createApp(
  deps: {
    getUser(req: Request): Promise<{ id: string }>;
    store: HeartbeatStore;
    progressStore?: ProgressStore;
    lifecycleStore: LifecycleStore;
    poolBuilder: PoolBuilder;
    closingStore: ClosingStore & VotingStore;
    joinStore?: JoinStore;
    friendsStore?: FriendsStore;
    profileStore?: ProfileStore;
    groupsStore?: GroupsStore;
    safetyStore?: SafetyStore;
    inviteStore?: InviteStore;
    accountStore?: AccountStore;
    sweepStore?: SweepStore;
    notifyStore?: NotifyStore;
    plansStore?: PlansStore;
    cacheCleanupStore?: CacheCleanupStore;
    hangStore?: HangStore;
    cronSecret?: string;
    discoverPool?: PoolBuilder;
    discoverStore?: {
      preferences(userId: string): Promise<DiscoverPreferences>;
      saved(userId: string): Promise<{ placeId: string; createdAt: string }[]>;
      save(userId: string, placeId: string): Promise<void>;
      remove(userId: string, placeId: string): Promise<void>;
    };
    checkLimit?: (
      scope: 'create' | 'start' | 'refresh',
      userId: string,
      pickId?: string,
    ) => Promise<void>;
    refreshHours?: Parameters<typeof getPick>[3];
  },
  basePath = '',
) {
  const app = new Hono().basePath(basePath);
  app.use(
    '*',
    cors({
      origin: '*',
      allowHeaders: ['Authorization', 'Content-Type', 'apikey', 'x-client-info'],
      allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    }),
  );
  app.onError((error, c) => {
    const response = errorResponse(error);
    return c.json(response.body, response.status);
  });
  app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }, 404));
  app.get('/health', (c) => c.json({ status: 'ok' }));
  app.post('/internal/sweep', async (c) => {
    authorizeSweep(c.req.header('x-cron-secret'), deps.cronSecret);
    if (!deps.sweepStore) {
      throw new ApiError(503, 'SERVER_NOT_CONFIGURED', 'Deadline automation is not configured');
    }
    const result = await sweepDeadlines(deps.sweepStore, deps.closingStore);
    const cacheCleanup = await cleanupCache(deps.cacheCleanupStore);
    console.info(JSON.stringify({ service: 'sweep', event: 'cache_cleanup', ...cacheCleanup }));
    const status =
      result.status === 'ok' && cacheCleanup.status !== 'partial_failure'
        ? 'ok'
        : 'partial_failure';
    return c.json({ ...result, status, cacheCleanup }, status === 'ok' ? 200 : 503);
  });
  app.get('/hang', async (c) => {
    const user = await deps.getUser(c.req.raw);
    if (!deps.hangStore) throw new ApiError(503, 'HANG_UNAVAILABLE', 'Hang posts unavailable');
    c.header('Cache-Control', 'private, no-store');
    return c.json({
      posts: await deps.hangStore.listOwn(user.id, new Date().toISOString()),
      sharedAvailable: false,
      notice: 'Sharing and responses are not available yet.',
    });
  });
  app.post('/hang', async (c) => {
    const user = await deps.getUser(c.req.raw);
    const input = parseHang(await readJsonBody(c));
    if (!deps.hangStore) throw new ApiError(503, 'HANG_UNAVAILABLE', 'Hang posts unavailable');
    return c.json(await deps.hangStore.create(user.id, input), 201);
  });
  app.post('/hang/:id/respond', async (c) => {
    const user = await deps.getUser(c.req.raw);
    if (!deps.hangStore) throw new ApiError(503, 'HANG_UNAVAILABLE', 'Hang posts unavailable');
    return c.json(
      await respondHang(deps.hangStore, c.req.param('id'), user.id, await readJsonBody(c)),
    );
  });
  app.post('/hang/:id/pick', async (c) => {
    const user = await deps.getUser(c.req.raw);
    if (!deps.hangStore) throw new ApiError(503, 'HANG_UNAVAILABLE', 'Hang posts unavailable');
    return c.json(await hangPick(deps.hangStore, c.req.param('id'), user.id));
  });
  app.post('/picks/:id/swipes', async (c) => {
    const user = await deps.getUser(c.req.raw);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      throw new ApiError(400, 'INVALID_JSON', 'Request body must be valid JSON');
    }
    const pickId = c.req.param('id');
    const result = await swipe(deps.store, pickId, user.id, body);
    // The swipe is already saved, so a failed auto-close must not turn it into
    // an error; the next swipe, the host, or the deadline sweep closes it instead.
    try {
      await closePick(deps.closingStore, pickId, 'system', null);
    } catch (error) {
      console.error(
        'auto-close after swipe failed',
        error instanceof Error ? error.name : 'unknown',
      );
    }
    return c.json(result);
  });
  // Legacy alias of /close: routes through the canonical closer so the final vote
  // always gets vote_deadline_at and the deadline sweep can finish it.
  app.post('/picks/:id/rank', async (c) => {
    const user = await deps.getUser(c.req.raw);
    return c.json(await closePick(deps.closingStore, c.req.param('id'), 'host', user.id));
  });
  // Live progress (counts only). The app polls this when Realtime is unavailable.
  app.get('/picks/:id/progress', async (c) => {
    const user = await deps.getUser(c.req.raw);
    if (!deps.progressStore) throw new ApiError(503, 'NOT_CONFIGURED', 'Progress is not available');
    return c.json(await getProgress(deps.progressStore, c.req.param('id'), user.id));
  });
  app.get('/discover', async (c) => {
    const user = await deps.getUser(c.req.raw);
    c.header('Cache-Control', 'private, no-store');
    const requests = parseDiscover(new URL(c.req.url).searchParams);
    if (!deps.discoverStore || !deps.discoverPool)
      throw new ApiError(503, 'NOT_CONFIGURED', 'Discover is unavailable');
    const result = await discover(
      deps.discoverPool,
      requests,
      await deps.discoverStore.preferences(user.id),
    );
    return c.json({
      ...result,
      notice: result.fallback
        ? 'Showing fixture places. Live places may be unavailable or the daily provider limit reached.'
        : null,
    });
  });
  app.get('/saved', async (c) => {
    const user = await deps.getUser(c.req.raw);
    c.header('Cache-Control', 'private, no-store');
    if (!deps.discoverStore) throw new ApiError(503, 'NOT_CONFIGURED', 'Saved places unavailable');
    return c.json({ places: await deps.discoverStore.saved(user.id) });
  });
  for (const method of ['post', 'delete'] as const) {
    app[method]('/saved/:placeId', async (c) => {
      const user = await deps.getUser(c.req.raw);
      const placeId = c.req.param('placeId');
      if (!placeId.trim() || placeId.length > 256 || /[\u0000-\u001f]/.test(placeId))
        throw new ApiError(400, 'INVALID_INPUT', 'Invalid place ID');
      if (!deps.discoverStore)
        throw new ApiError(503, 'NOT_CONFIGURED', 'Saved places unavailable');
      if (method === 'post') await deps.discoverStore.save(user.id, placeId);
      else await deps.discoverStore.remove(user.id, placeId);
      return c.json({ status: 'ok' });
    });
  }
  app.post('/picks', async (c) => {
    const user = await deps.getUser(c.req.raw);
    const body = await readJsonBody(c);
    parseCreatePick(body);
    await deps.checkLimit?.('create', user.id);
    // With { groupId }, everyone in the group is added too (0012_groups.sql).
    return c.json(
      await createPickMaybeForGroup(deps.lifecycleStore, deps.groupsStore, user.id, body),
      201,
    );
  });
  app.get('/picks/:id', async (c) => {
    c.header('Cache-Control', 'private, no-store');
    const user = await deps.getUser(c.req.raw);
    return c.json(
      await getPick(deps.lifecycleStore, c.req.param('id'), user.id, deps.refreshHours),
    );
  });
  app.post('/picks/:id/start', async (c) => {
    const user = await deps.getUser(c.req.raw);
    return c.json(
      await startPick(
        deps.lifecycleStore,
        deps.poolBuilder,
        c.req.param('id'),
        user.id,
        () => deps.checkLimit?.('start', user.id, c.req.param('id')) ?? Promise.resolve(),
      ),
    );
  });
  app.post('/picks/:id/refresh', async (c) => {
    const user = await deps.getUser(c.req.raw);
    const body = await readJsonBody(c);
    return c.json(
      await refreshPick(
        deps.lifecycleStore,
        deps.poolBuilder,
        c.req.param('id'),
        user.id,
        body,
        () => deps.checkLimit?.('refresh', user.id, c.req.param('id')) ?? Promise.resolve(),
      ),
    );
  });
  app.post('/picks/:id/cancel', async (c) => {
    const user = await deps.getUser(c.req.raw);
    const body = await readJsonBody(c);
    return c.json(await cancelPick(deps.lifecycleStore, c.req.param('id'), user.id, body));
  });
  app.post('/picks/:id/close', async (c) => {
    const user = await deps.getUser(c.req.raw);
    return c.json(await closePick(deps.closingStore, c.req.param('id'), 'host', user.id));
  });
  app.post('/picks/:id/vote', async (c) => {
    const user = await deps.getUser(c.req.raw);
    const body = await readJsonBody(c);
    return c.json(await castVote(deps.closingStore, c.req.param('id'), user.id, body));
  });
  app.post('/picks/:id/close-vote', async (c) => {
    const user = await deps.getUser(c.req.raw);
    return c.json(await closeVote(deps.closingStore, c.req.param('id'), user.id));
  });
  // Join by code (Lobby code / QR / wtw://join/CODE). Static path, so it never
  // matches /picks/:id routes.
  app.post('/picks/join', async (c) => {
    const user = await deps.getUser(c.req.raw);
    const body = await readJsonBody(c);
    if (!deps.joinStore) throw new ApiError(503, 'NOT_CONFIGURED', 'Joining is not available');
    return c.json(await joinPick(deps.joinStore, user.id, body));
  });
  // Friends: one row per pair (0008_friendships.sql). The user is authenticated
  // before the store is checked, like /picks/join.
  const friends = async (c: { req: { raw: Request } }) => {
    const user = await deps.getUser(c.req.raw);
    if (!deps.friendsStore) throw new ApiError(503, 'NOT_CONFIGURED', 'Friends are not available');
    return { user, store: deps.friendsStore };
  };
  app.get('/friends', async (c) => {
    c.header('Cache-Control', 'private, no-store');
    const { user, store } = await friends(c);
    return c.json(await listFriends(store, user.id));
  });
  app.post('/friends/requests', async (c) => {
    const { user, store } = await friends(c);
    // Same answer whether or not the email has an account (or blocked the caller).
    return c.json(
      await requestFriendSafely(
        {
          takeFriendRequestLimit: (id) => store.takeFriendRequestLimit(id),
          request: (id, email) => store.request(id, email.toLowerCase()),
        },
        user.id,
        await readJsonBody(c),
      ),
    );
  });
  app.post('/friends/:id/accept', async (c) => {
    const { user, store } = await friends(c);
    return c.json(await acceptFriend(store, user.id, c.req.param('id')));
  });
  app.post('/friends/:id/remove', async (c) => {
    const { user, store } = await friends(c);
    return c.json(await removeFriend(store, user.id, c.req.param('id')));
  });
  // The caller's own display name ("what should we call you?" and the Profile tab).
  // The row is always the verified caller's; the body cannot name another user.
  app.post('/me', async (c) => {
    const user = await deps.getUser(c.req.raw);
    const body = await readJsonBody(c);
    if (!deps.profileStore) throw new ApiError(503, 'NOT_CONFIGURED', 'Profiles are not available');
    return c.json(await updateMe(deps.profileStore, user.id, body));
  });
  // My inbox (newest 50) and push registration. Always the verified caller's own rows.
  app.get('/notifications', async (c) => {
    c.header('Cache-Control', 'private, no-store');
    const user = await deps.getUser(c.req.raw);
    return c.json(await listNotifications(requireNotify(), user.id));
  });
  app.post('/notifications/:id/read', async (c) => {
    const user = await deps.getUser(c.req.raw);
    return c.json(await markNotificationRead(requireNotify(), c.req.param('id'), user.id));
  });
  app.post('/push-tokens', async (c) => {
    const user = await deps.getUser(c.req.raw);
    const body = await readJsonBody(c);
    return c.json(await registerPushToken(requireNotify(), user.id, body));
  });
  app.post('/push-tokens/remove', async (c) => {
    const user = await deps.getUser(c.req.raw);
    const body = await readJsonBody(c);
    return c.json(await unregisterPushToken(requireNotify(), user.id, body));
  });
  // After the winner: plan time, RSVP, "Did you go?", reasons, history, Pick again.
  // Membership, host and state are rechecked inside each RPC (0013_plans_rsvp.sql).
  app.get('/picks/:id/plan', async (c) => {
    c.header('Cache-Control', 'private, no-store');
    const user = await deps.getUser(c.req.raw);
    return c.json(await getPlan(requirePlans(), c.req.param('id'), user.id));
  });
  app.get('/picks/:id/reasons', async (c) => {
    const user = await deps.getUser(c.req.raw);
    return c.json(await getReasons(requirePlans(), c.req.param('id'), user.id));
  });
  app.post('/picks/:id/plan-time', async (c) => {
    const user = await deps.getUser(c.req.raw);
    const body = await readJsonBody(c);
    return c.json(await setPlanTime(requirePlans(), c.req.param('id'), user.id, body));
  });
  app.post('/picks/:id/rsvp', async (c) => {
    const user = await deps.getUser(c.req.raw);
    const body = await readJsonBody(c);
    return c.json(await rsvp(requirePlans(), c.req.param('id'), user.id, body));
  });
  app.post('/picks/:id/outcome', async (c) => {
    const user = await deps.getUser(c.req.raw);
    const body = await readJsonBody(c);
    return c.json(await recordOutcome(requirePlans(), c.req.param('id'), user.id, body));
  });
  app.post('/picks/:id/again', async (c) => {
    const user = await deps.getUser(c.req.raw);
    return c.json(await pickAgain(requirePlans(), c.req.param('id'), user.id), 201);
  });
  app.get('/history', async (c) => {
    c.header('Cache-Control', 'private, no-store');
    const user = await deps.getUser(c.req.raw);
    return c.json(await getHistory(requirePlans(), user.id));
  });
  app.get('/groups/:id/history', async (c) => {
    c.header('Cache-Control', 'private, no-store');
    const user = await deps.getUser(c.req.raw);
    return c.json(await getHistory(requirePlans(), user.id, c.req.param('id')));
  });
  function requirePlans(): PlansStore {
    if (!deps.plansStore) throw new ApiError(503, 'NOT_CONFIGURED', 'Plans are not available');
    return deps.plansStore;
  }
  function requireNotify(): NotifyStore {
    if (!deps.notifyStore) {
      throw new ApiError(503, 'NOT_CONFIGURED', 'Notifications are not available');
    }
    return deps.notifyStore;
  }
  // My name, survey answers and whether onboarding is done. Preferences are private
  // (no client column grant), so the app reads them here rather than through RLS.
  app.get('/me', async (c) => {
    const user = await deps.getUser(c.req.raw);
    if (!deps.profileStore) throw new ApiError(503, 'NOT_CONFIGURED', 'Profiles are not available');
    return c.json(await getMe(deps.profileStore, user.id));
  });
  // The onboarding survey (FR-02); also "Edit preferences" on the Profile tab.
  app.post('/me/preferences', async (c) => {
    const user = await deps.getUser(c.req.raw);
    const body = await readJsonBody(c);
    if (!deps.profileStore) throw new ApiError(503, 'NOT_CONFIGURED', 'Profiles are not available');
    return c.json(await updatePreferences(deps.profileStore, user.id, body));
  });
  // Groups (0012_groups.sql). Authenticate first, then check the store, like /picks/join.
  const groups = async (c: { req: { raw: Request } }) => {
    const user = await deps.getUser(c.req.raw);
    if (!deps.groupsStore) throw new ApiError(503, 'NOT_CONFIGURED', 'Groups are not available');
    return { user, store: deps.groupsStore };
  };
  app.post('/picks/:id/invite', async (c) => {
    const { user, store } = await groups(c);
    return c.json(
      await inviteToPick(
        store,
        user.id,
        c.req.param('id'),
        await readJsonBody(c),
        deps.lifecycleStore.notifier,
      ),
    );
  });
  app.post('/groups', async (c) => {
    const { user, store } = await groups(c);
    return c.json(await createGroup(store, user.id, await readJsonBody(c)), 201);
  });
  app.post('/groups/:id/rename', async (c) => {
    const { user, store } = await groups(c);
    return c.json(await renameGroup(store, user.id, c.req.param('id'), await readJsonBody(c)));
  });
  app.post('/groups/:id/delete', async (c) => {
    const { user, store } = await groups(c);
    return c.json(await deleteGroup(store, user.id, c.req.param('id')));
  });
  app.post('/groups/:id/members', async (c) => {
    const { user, store } = await groups(c);
    return c.json(await addGroupMembers(store, user.id, c.req.param('id'), await readJsonBody(c)));
  });
  app.post('/groups/:id/members/:userId/remove', async (c) => {
    const { user, store } = await groups(c);
    return c.json(
      await removeGroupMember(store, user.id, c.req.param('id'), c.req.param('userId')),
    );
  });
  app.post('/groups/:id/leave', async (c) => {
    const { user, store } = await groups(c);
    return c.json(await leaveGroup(store, user.id, c.req.param('id')));
  });
  // Safety and invites (0014). The user is authenticated before the store is checked.
  const safety = async (c: { req: { raw: Request } }) => {
    const user = await deps.getUser(c.req.raw);
    if (!deps.safetyStore)
      throw new ApiError(503, 'NOT_CONFIGURED', 'Safety tools are not available');
    return { user, store: deps.safetyStore };
  };
  const invites = async (c: { req: { raw: Request } }) => {
    const user = await deps.getUser(c.req.raw);
    if (!deps.inviteStore)
      throw new ApiError(503, 'NOT_CONFIGURED', 'Invite links are not available');
    return { user, store: deps.inviteStore };
  };
  app.post('/picks/:id/lock', async (c) => {
    const { user, store } = await safety(c);
    const body = await readJsonBody(c);
    return c.json(await setLobbyLocked(store, c.req.param('id'), user.id, body));
  });
  app.post('/blocks/:userId', async (c) => {
    const { user, store } = await safety(c);
    return c.json(await blockUser(store, user.id, c.req.param('userId')));
  });
  app.post('/blocks/:userId/remove', async (c) => {
    const { user, store } = await safety(c);
    return c.json(await unblockUser(store, user.id, c.req.param('userId')));
  });
  app.post('/reports', async (c) => {
    const { user, store } = await safety(c);
    const body = await readJsonBody(c);
    return c.json(await createReport(store, user.id, body), 201);
  });
  app.post('/invites', async (c) => {
    const { user, store } = await invites(c);
    const body = await readJsonBody(c);
    return c.json(await createInvite(store, user.id, body), 201);
  });
  app.post('/invites/:token/accept', async (c) => {
    const { user, store } = await invites(c);
    return c.json(await acceptInvite(store, c.req.param('token'), user.id));
  });
  app.delete('/invites/:token', async (c) => {
    const { user, store } = await invites(c);
    return c.json(await revokeInvite(store, c.req.param('token'), user.id));
  });
  // Deletes the caller's account and all of their data (0017). The app signs out after.
  app.delete('/me', async (c) => {
    const user = await deps.getUser(c.req.raw);
    if (!deps.accountStore) {
      throw new ApiError(503, 'NOT_CONFIGURED', 'Account deletion is not available');
    }
    return c.json(await deleteAccount(deps.accountStore, user.id));
  });
  return app;
}
