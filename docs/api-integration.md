# Backend integration and deployment contract (Josh)

Phase 1 Places services are available separately; existing HTTP response shapes
remain unchanged. See [Places integration instructions](places-phase1.md) for
Alan's pool interface, hours response enrichment, provider configuration and the
Google snapshot-retention blocker before enabling real provider persistence.

Status: **IMPLEMENTED** lifecycle/closing, sweep, read-time hours and CD workflow.
**CI VERIFIED:** PR validation and local database/API jobs pass, including the hours
integration; the deploy job correctly skips on PRs. **HOSTED VERIFIED:** hosted CD,
cron delivery and real backend Google requests are not yet verified. **BLOCKED/PLANNED:**
Google lifecycle persistence/wiring and Realtime. Heartbeat RPCs are in `0002`,
lifecycle in `0003`, canonical closing/voting in `0004`, and cron scheduling in `0005`.

## HTTP contract

Base URL: `<SUPABASE_URL>/functions/v1/api`.

- `GET /health`: public liveness only; `{ "status": "ok" }`. Does not check database readiness.
- `POST /picks/:id/swipes`: Bearer user access token; body `{ "placeId": "...", "value": 2 }`.
  Values: 0 No, 1 Maybe, 2 Yes. Returns `{ "status": "ok" }` after persistence.
- `POST /picks/:id/rank`: Bearer user access token; host must also be a participant.
  Returns `results: [{ placeId, rank }]` (ordered top three) and `decision`:
  `{ kind: "winner", winner: { placeId, rank } }` or
  `{ kind: "vote", finalists: [{ placeId, rank }] }` (includes ties beyond three).
  Scores and other scoring internals stay server-side.

- `POST /picks` (**proposed by Mike, Alan to confirm/implement**): Bearer user access token; body
  `{ "category": "food" | "activities", "center": { "lat", "lng" }, "radiusM": 3219, "poolSize": 20,
  "deadlineAt": "<ISO 8601>" | null, "closeThreshold": 100 }`.
  Validate with `validateCreatePick` from `_shared/domain/createPick.ts` (same limits as the
  `picks` table checks; pool size 5–30; deadline 5 min – 7 days ahead) and return
  400 `INVALID_INPUT` on any problem. Creates a `draft` Pick with the caller as host and first
  participant, fills `pick_candidates` with up to `poolSize` places from the provider, and
  returns 201 `{ "pickId": "...", "state": "draft" }`. The app's mock (`src/lib/mock/api.ts`)
  implements exactly this.

- `GET /picks/:id/progress` (**Mike, Week 3**): Bearer user access token; participants only
  (403 `FORBIDDEN` otherwise, 404 `PICK_NOT_FOUND`). Counts only, never answers or ballots:
  `{ state, deadlineAt, doneCount, votedCount, total, participants: [{ userId, displayName,
  isHost, isMe, done, voted }] }`. `done` = answered every candidate. Host first, then by join
  time. The app polls this every 5 s when Realtime is down (`src/hooks/usePickLive.ts`).
  Implemented in `_shared/api/progress.ts` + `api/progressStore.ts` (service-role reads).

### Live updates (Mike)

The app subscribes to Supabase Realtime `postgres_changes` on `picks` (`id=eq.<pick>`) and
`pick_participants` (`pick_id=eq.<pick>`), and re-reads `GET /picks/:id/progress` on any event.
`0005_live_progress.sql` adds both tables to the `supabase_realtime` publication and a trigger on
`preferences` that sets `pick_participants.finished_at` when someone has answered every candidate
(and clears it if their answers are wiped by a refresh). Realtime applies the same SELECT RLS as
normal reads. `preferences`, `final_votes` and `ranking_results` are deliberately **not** published.
Test: `supabase/tests/live_progress_test.sql`.

### Groups (Razin, M4)

Reusable groups for repeat Picks (FR-04, FR-05). All routes need a Bearer user access token;
the caller is always the token's user. Non-members get 404 (never 403), so a group id reveals
nothing to outsiders.

- `POST /groups` `{ "name" }` → 201 `{ id, name, ownerId }`. Names are trimmed, 1–50 characters.
- `POST /groups/:id/rename` `{ "name" }`, `POST /groups/:id/delete` → `{ status: "ok" }`. Owner
  only (403 `FORBIDDEN`). Deleting keeps every past Pick and result (`picks.group_id` → null).
- `POST /groups/:id/members` `{ "userIds": [...] }` (1–25) → `{ invited, added: 0 }`.
  Owner only; accepted friends only, all or nothing. Migration 0025 makes these pending
  recipient requests; this call never adds membership. Members and duplicate pending
  requests are skipped. Acceptance enforces the 25-member cap.
- `POST /groups/:id/members/:userId/remove` → `{ status: "ok" }`. Owner only; idempotent; 409
  `OWNER_CANNOT_LEAVE` for the owner. `POST /groups/:id/leave`: anyone but the owner (same 409).
- `POST /picks` accepts an optional `"groupId"`. The caller must be a member (404
  `GROUP_NOT_FOUND`); the draft is created as before, then `pick_add_group` adds everyone in the
  group **now** and returns 201 `{ pickId, state, groupId, added }`. If that second step fails,
  the empty draft is canceled. Without `groupId` the route is unchanged.
- `POST /picks/:id/invite` `{ "userIds": [...] }` → `{ added }`: host only, friends only (403
  `NOT_FRIENDS`), while the Pick is `draft` or `swiping` (409 `PICK_CLOSED`), the same window as
  joining by code.
- Removing or leaving never touches `pick_participants`: people keep the Picks they were in
  (and their results) and are simply not added to new group Picks.
- Code: `_shared/api/groups.ts` (validation, POST /picks composition), `api/groupsStore.ts`
  (adapter). Client: `api.createGroup/renameGroup/deleteGroup/addGroupMembers/
  removeGroupMember/leaveGroup/createGroupPick/inviteToPick`; reads are RLS queries
  (`queries.listMyGroups`, `getGroup`, `listMyFriends`). Mock: `src/lib/mock/groups.ts`.
- `0012_groups.sql`: `groups (id, name, owner_id)`, `group_members (group_id, user_id, role
  owner|member, unique (group_id, user_id), one owner)`, `picks.group_id`. RLS: members can
  SELECT the group, its members and their `profiles.display_name`; no client writes. RPCs
  (service role only): `group_create`, `group_rename`, `group_delete`, `group_add_members`,
  `group_remove_member`, `group_leave`, `pick_add_group`, `pick_invite`. They raise PT400/403/
  404/409 with a HINT (`not_owner`, `not_friends`, …) that the adapter maps to the codes above.
- **Dependency on 0008 (PR #24):** friend checks read `public.friendships` through
  `private.are_friends`, written in PL/pgSQL so 0012 applies with or without 0008. Until 0008
  is applied there is no table, the check answers false, and nobody can be added (fail closed);
  everything else works. `queries.listMyFriends` returns `[]` in that case.
- Tests: `supabase/tests/groups_test.sql` (creates a stand-in `friendships` inside its
  rolled-back transaction when 0008 is absent), `api/app_test.ts`, `tests/groupsStore.test.ts`,
  `tests/lib/mockGroups.test.ts`, `tests/api/groups.test.mjs` (HTTP, in `npm run test:api`).

### Pick routes the app calls

The app's typed client (`src/lib/api.ts`) and its mock (`src/lib/mock/api.ts`) follow these
exactly: `GET /picks/:id`, `POST /picks/:id/start`, `/refresh` (`{ confirm }`, 409
`CONFIRM_REQUIRED`), `/cancel` (Alan, PR #12); `POST /picks/:id/close`, `/vote` (`{ placeId }`),
`/close-vote` (Alan, PR #13). The lobby reads the join code from `pick_join_codes`
(`code, expires_at`, Razin; see below).

### Join by code (Razin)

- `POST /picks/join`: Bearer user access token; body `{ "code": "K7P2QX" }`. Case and spaces
  are ignored; anything that isn't 6 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` is
  400 `INVALID_INPUT` (checked before the database). Returns 200 `{ "pickId": "..." }`.
  Since 0014, every failure is the same 404 `JOIN_CODE_NOT_FOUND`: unknown or expired code, a
  Pick past `swiping`, a locked lobby, a full Pick (30), or a host who blocked you (either way).
  After 10 failed joins (by code or invite link) in an hour: 429 `RATE_LIMITED`. Someone already
  in the Pick gets 200 with the same `pickId` and no second row, in any state.
  Code: `_shared/api/join.ts` (validation), `_shared/domain/joinCode.ts` (code rules, shared
  with the app), `api/joinStore.ts` (adapter). Client: `api.joinPick(code)`; the mock accepts
  `WTW234` for a friend's draft Pick.
- RPC `pick_join(p_code text, p_user_id uuid) returns jsonb` (`0014_invites_safety.sql`, which
  replaced 0006's), service role only. `{ ok: true, pickId }` or `{ ok: false, reason: 'invalid'
  | 'rate_limited' }`. It returns instead of raising so the failed attempt it records in
  `join_attempts` is committed. Locks the Pick row; the participant insert advances
  `picks.version` (0002 trigger). PT403 only if the caller has no profile.
- Codes: `pick_join_codes (code pk, pick_id, expires_at not null, created_at)`. A trigger on
  `picks` issues one for every new Pick (7-day expiry); 0006 backfilled draft/swiping Picks.
  Participants read them through RLS (`queries.getJoinCode`: newest `expires_at` first).
- App: the Lobby's QR/share link is `wtw://join/CODE` → `app/join/[code].tsx` (outside the auth
  guard: signed out, it signs in first and then joins); the Picks tab has "Join with code".
  Both open `/pick/[id]`, which forwards a draft Pick to the Lobby.

### Friends (Mike, M3)

- All routes need a Bearer user access token; the caller is always the token's user.
  - `GET /friends` → `{ friends, incoming }`, each `[{ userId, displayName, since }]`, requests
    you sent not included (see 0018 below), newest first (`since` = accepted for friends, sent for requests). `Cache-Control: private, no-store`.
  - `POST /friends/requests` `{ "email": "..." }` → always `{ status: "sent" }`, whether or not
    the email has an account. Exact email match (case and surrounding spaces ignored). 400
    `CANNOT_FRIEND_SELF`, 400 `INVALID_INPUT`, 429 `RATE_LIMITED` after 20 a day. If they already
    asked you, this accepts; asking again changes nothing.
  - `POST /friends/:userId/accept` → `{ status: "accepted" }`; 404 `REQUEST_NOT_FOUND` unless
    they sent you a request (accepting twice is fine).
  - `POST /friends/:userId/remove` → `{ status: "ok" }`: decline, cancel, or unfriend. Idempotent.
  - Code: `_shared/api/friends.ts` (validation, grouping), `api/friendsStore.ts` (adapter).
    Client: `api.listFriends/addFriend/acceptFriend/removeFriend`; the mock
    (`src/lib/mock/friends.ts`) starts with Ava, Ben, Cam as friends and a request from Jordan.
- `0008_friendships.sql`: `friendships (requester_id, addressee_id, status pending|accepted,
  created_at, accepted_at)`, one row per pair either way, no self rows. RLS: the two people in a
  row can SELECT it, and can read each other's `profiles.display_name`. No client writes.
  RPCs (service role only): `friend_request`, `friend_accept`, `friend_remove`, `friend_list`;
  PT404 / PT400 / PT403 as above. Emails stay in `auth.users` and are never returned.
- `0018_private_outgoing_requests.sql`: a pending request is visible only to the person it was
  sent to. The sender can't see the row or the name through RLS, `profiles` or `friend_list`,
  because that would reveal who has an account. Trade-off: a sender can't see or cancel a pending
  request; the other person can decline it, and a repeat request changes nothing.

### My display name (Razin's Week 2 task)

- `POST /me`: Bearer user access token; body `{ "displayName": "Ava" }`. Trimmed, then 1–50
  characters counted like Postgres `char_length` (an emoji is one), one line (no control
  characters); otherwise 400 `INVALID_INPUT`, checked before the database. Returns 200
  `{ "displayName": "Ava" }`. It always writes the verified caller's own `profiles` row; any
  other field in the body (e.g. a `userId`) is ignored. POST, like every other mutation, so
  CORS stays `GET, POST`.
  Code: `_shared/api/profile.ts` (`validateDisplayName`, shared with the app and the mock),
  `api/profileStore.ts` (service-role upsert of `display_name` + `updated_at`, so an account
  without a profile row still gets one). No migration: `profiles` and its 1–50 check are in
  `0001_init.sql`, and clients still only read it through RLS (own row + co-participants).
- App: `ProfileProvider` (`src/hooks/useProfile.tsx`) reads my profile with `GET /me` (see
  "Onboarding survey" below). While `display_name` is null the root layout's guard shows
  `app/welcome.tsx` ("What should we call you?", prefilled from the email's local part)
  instead of the tabs; Save calls `api.updateMe(name)` and the guard moves on. If the read fails
  or times out (4 s) the step is skipped rather than blocking the app. The Profile tab shows
  and edits the same name. Mock mode starts with no name, so the step shows there too.
- Names show wherever `GET /picks/:id/progress` is used (Lobby, Waiting room, votes); a
  participant without a name is still shown as "Someone".
- `scripts/wtw-dev-code.mjs` (PR #21) can still set names server-side on wtw-dev, e.g. for
  seeded demo accounts; the app's step only appears for accounts that still have no name.

### Notifications and push (Alan, M4)

- App (Mike): the Picks header has a bell with an unread badge (`NotificationBell`,
  `useUnreadCount`: refreshed on focus and when a push arrives). It opens `app/inbox.tsx`, which
  lists `GET /notifications`. Tapping a row marks it read and opens `/pick/<pickId>`. There's no
  "mark all read" route, and the count covers the newest 50 rows.

- `GET /notifications`: my newest 50, newest first, `Cache-Control: private, no-store`.
  Returns `{ notifications: [{ id, type, pickId, payload, createdAt, readAt }], unreadCount }`.
  Clients may also read `notifications` through RLS (own rows only).
- `POST /notifications/:id/read`: 200 `{ status: "ok" }`; 404 `NOTIFICATION_NOT_FOUND` for an
  unknown id or someone else's (same answer, so ids can't be probed).
- `POST /push-tokens` `{ token: "ExponentPushToken[…]", platform: "ios" | "android" }`: the
  device's token now belongs to the caller (a phone that switches accounts moves with it).
  400 for a malformed token. Client: Mike's `api.registerPushToken` (PR #29).
- `POST /push-tokens/remove` `{ token }`: call on sign-out so the phone stops getting this
  account's pushes. Only removes the caller's own token; anything else is a silent no-op.
- `POST /picks/:id/cancel` now takes an optional `{ reason }` (trimmed, ≤ 200 characters, 400
  otherwise), stored in `picks.cancel_reason` and shown in everyone's inbox.
- Events (`notify()` in `_shared/api/notify.ts`): `pick_started` (everyone but the host),
  `vote_needed` / `winner_decided` (everyone, from the canonical closers, so host close,
  auto-close and the sweep all send it), `pick_canceled` (everyone but the host, reason in the
  payload), `reminder` (the sweep, unfinished participants when the deadline is < 1 hour away, only for
  Picks created more than 2 hours before their deadline, so a short Pick never gets it at Start).
  `added_to_pick`, `plan_time_set`, `plan_reminder`, `did_you_go` are reserved for groups/invites
  (Razin) and RSVP (Alan, next PR). Razin/Josh: call `lifecycleStore.notifier` /
  `closingStore.notifier` with `(userIds, type, pickId, payload?)`; it never throws.
- Once per person per event per Pick is a database rule: a unique index on
  `notifications (user_id, pick_id, type)` (except `plan_time_set`). `notify_insert` returns
  only the users who got a new row, and only they are pushed, so retries never double-push.
- Push text is generic (`PUSH_TEXT`): no place names, answers or cancel reasons on lock screens.
  Sent through the Expo Push API in batches of 100 with a 5 s timeout per request; tokens Expo reports as
  `DeviceNotRegistered` are deleted. Push receipts are not checked yet.
- Late joins: unchanged from 0006. Swiping = join and swipe; `final_vote` = only people who
  were already in vote; `completed` = read only for participants.
- Tables/RPCs (`0009_notifications.sql`): `notifications`, `push_tokens` (no client access),
  `notify_insert`, `notification_mark_read`, `push_token_register`, `pick_reminder_targets`,
  `pick_cancel(p_pick_id, p_user_id, p_reason default null)`. Adapter: `api/notifyStore.ts`.

### Onboarding survey (FR-02, Mike M4, migration 0011)

- `GET /me`: Bearer token. Returns `{ displayName, preferences, onboarded }` for the verified
  caller only. `preferences` is `{ categories, types, dislikedTypes, priceMax, maxDistanceM }`;
  stored keys that are missing or invalid read as unset. `onboarded` is
  `preferences_updated_at is not null`.
- `POST /me/preferences`: body `{ "preferences": { … } }`. Every key is optional, but each value
  must be one of the options in `_shared/domain/preferences.ts` (`categories` food|activities,
  `types` Places Table A types, `dislikedTypes` food types only and never also liked, `priceMax`
  1–4, `maxDistanceM` one of the offered distances); otherwise 400 `INVALID_INPUT` before the
  database. All-empty answers are valid (the Skip button). Returns
  `{ preferences, onboarded: true }`.
- Storage: `profiles.discover_preferences` (jsonb, the column Josh's 0010 adds for Discover
  scoring, whose `categories`/`types`/`priceMax` keys this matches) and
  `profiles.preferences_updated_at`. 0011 adds the jsonb column only `if not exists` and repeats
  0010's column grant, so clients can read `display_name` but never anyone's survey answers,
  their own included; the API reads them with the service role. **Merge #26 (0010) first.**
- App: after the name step the guard shows `app/onboarding.tsx`: the survey, then a location
  explainer and a notifications explainer, each before its system prompt and each skippable.
  Saving at the end sets `onboarded`. The Profile tab summarizes the answers and opens
  `app/preferences.tsx` to edit them. As with the name, a failed `GET /me` skips onboarding
  rather than blocking the app.
- Push (client only, waiting on Alan's routes): once notifications are allowed, the app sends its
  Expo push token to `POST /push-tokens { token, platform }` on every start (errors ignored until
  the route exists; needs the EAS project id). A tapped notification opens its `url`, or
  `/pick/<pickId>` for server pushes that carry only `pickId`, including the tap that launched
  the app.
- Account deletion (client only, waiting on Razin's `DELETE /me`): Profile tab → "Delete account"
  → confirm → `DELETE /me` → "Your account was deleted" → signed out. A 404 shows "not available
  yet". Note: CORS currently allows `GET, POST` only; `DELETE /me` needs `DELETE` added.

### After the winner, history, Pick again (Alan, M4)

All Bearer user token; the caller is always the verified user. A stranger gets 404 (never 403),
so a Pick id reveals nothing. 409 `INVALID_PICK_STATE` when the Pick isn't at that step.

- `GET /picks/:id/plan` (`no-store`): `{ state, isHost, planAt, participantCount,
  rsvps: { going, maybe, notGoing }, myRsvp, outcomes: { went, didNotGo, again }, myOutcome }`.
  Counts only; who said what is never returned.
- `POST /picks/:id/plan-time` `{ planAt }`: host only, `completed` only, future and within 30
  days (400 otherwise). Notifies everyone else (`plan_time_set`). Moving the time re-arms the
  plan reminder and "Did you go?". The same time again is a no-op (nobody notified); after 5
  changes it's 409.
- `POST /picks/:id/rsvp` `{ status: "going" | "maybe" | "not_going" }`: participants, `completed`.
- `POST /picks/:id/outcome` `{ went: boolean, again?: boolean | null }`: "Did you go?".
- `GET /picks/:id/reasons`: `{ reasons: [{ placeId, rank, reason }] }` for the top three once
  the Pick is `final_vote` or `completed` (FR-14; words only, rank-only for groups under 4).
- `POST /picks/:id/again`: 201 `{ pickId, state: "draft" }`. **Host only** (403 otherwise).
  Same people, category, center, radius, pool size, close rule, filters and Custom Plan options
  (0019); no deadline. A group Pick keeps `group_id` only if the host is still in the group, and
  adds everyone in the group today (0020). If the host left, it adds old participants still in the group. Works from `completed` or `canceled`; a second tap
  while the first copy is still a draft returns that draft (nobody is notified again). Counts
  against the daily create limit. Notifies the others (`added_to_pick`).
- `GET /history` and `GET /groups/:id/history` (`no-store`): `{ picks: [{ id, category,
  decidedAt, decidedBy, planAt, groupId, winner: { placeId, name }, finalists: [{ placeId, rank,
  name }], participants: [{ userId, displayName }], wentCount }] }`, completed Picks the caller
  was in, newest first, at most 50. No scores, no answers. A group the caller isn't in (or before
  Razin's 0012 is installed) is 404 `GROUP_NOT_FOUND`.
- Sweep: `planEvents` in the sweep response counts Picks sent a `plan_reminder` (1 h before
  `plan_at`) or `did_you_go` (3 h after `plan_at`, or 24 h after `decided_at` with no time;
  only Picks decided in the last 14 days and after 0019 shipped; skips "not going" and people
  who already answered). The Winner screen's "Did you go?" card shows earlier: 1 h after
  `plan_at`, or 3 h after the decision. Prompts go to everyone who didn't say "not going"
  (including people who never answered the RSVP), on purpose, so the M5 "went" metric isn't
  limited to people who RSVP'd.
- Tables/RPCs (`0013_plans_rsvp.sql`): `picks.plan_at`, `pick_rsvps`, `pick_outcomes`
  (each person reads only their own row via RLS; no client writes), `pick_set_plan_time`, `pick_rsvp`,
  `pick_outcome`, `pick_plan_load`, `pick_history`, `pick_again`, `pick_finalist_counts`,
  `pick_plan_targets`. Adapter: `api/plansStore.ts`. App: `PlanBlock` on Winner,
  reasons on Results, `app/history.tsx`.
- Known limits (review, Oct 31): no per-user rate limit on `/rsvp`, `/outcome`, `/push-tokens`
  (Josh's limiter can cover them); a sweep that read targets just before the host moves the time
  can send one stale reminder (rare; accepted).

### Invites and safety (Razin, M4)

`0014_invites_safety.sql`. Clients read only their own `blocks` and `invite_links` rows;
`join_attempts`, `rate_limit_events` and `reports` have no client access. Every route below
verifies the token first (401), then 503 if unconfigured. RPC errors: PT400 → 400
`INVALID_INPUT`, PT403 → 403 `FORBIDDEN`, PT404 → 404, PT409 → 409 `PICK_CLOSED`, PT429 → 429
`RATE_LIMITED` (`api/rpcErrors.ts`).

- **Participant cap and blocks on every way in.** A trigger on `pick_participants` caps a Pick at
  30 (PT409, hint `pick_full`) and silently skips adding anyone the host blocked or who blocked
  the host. So it covers join codes, invite links, #30's `pick_invite`/`pick_add_group` and #32's
  "Pick again", whichever merge. A bulk add carries on, and a single add reports "0 added", never
  "blocked".
- `POST /picks/:id/lock` `{ "locked": true | false }` → `{ locked }`. Host only (403), while
  draft or swiping (409). A locked lobby admits nobody new by code or link; the host's own
  invites (#30) still work. The app reads `picks.lobby_locked` (`queries.getLobbyLocked`).
- `POST /blocks/:userId` / `POST /blocks/:userId/remove` → `{ status: 'ok' }`. 400 for a bad id
  or yourself, 404 for an unknown user. Idempotent. Blocking deletes any friendship or request
  either way; unblocking doesn't restore it. Blocked pairs can't friend each other (a
  `friendships` insert is skipped), join each other's Picks, or be added to the other's group
  (`group_members` insert skipped when the owner and the new member are blocked either way).
  Picks and groups they already share are left alone. The blocked person is never told.
- `POST /reports` `{ kind: 'user' | 'pick' | 'group', targetId, reason }` → 201. Reason 1–500
  characters, trimmed. A person (not yourself), or a Pick/group you're in; anything else is 404
  so a report never confirms something exists. 10 per user per day (429). Moderators read
  `public.reports` with the service role.
- `POST /invites` `{ kind: 'pick' | 'group', targetId, maxUses?: 1..100 | null }` → 201
  `{ token, url: "wtw://i/TOKEN", kind, targetId, expiresAt, maxUses }`. Pick: host only, draft or
  swiping. Group (#30): owner only. 20 per user per day. Tokens are 128 random bits
  (`gen_random_bytes(16)`), base64url without padding: 22 characters. Links expire after 7 days.
- `POST /invites/:token/accept` → `{ kind, targetId }`. Every unusable link is the same 404
  `INVITE_NOT_FOUND`: unknown, malformed, expired, revoked, used up, a closed/locked/full Pick, a
  full group (25), or a block between you and the link's creator or the Pick's host / group's
  owner. Failures count toward the same 10-an-hour join limit as codes (429). Someone already in
  gets 200 without using the link up.
- `DELETE /invites/:token` → `{ status: 'ok' }`. Creator only (404 otherwise); idempotent.
  CORS allows `DELETE`.
- App: Lobby (host) "Share invite link" and "Lock the lobby"; `app/i/[token].tsx` handles
  `wtw://i/TOKEN` (signed out, the token is parked in `expo-secure-store` under
  `wtw.pendingInvite` so it survives sign-in and a restart; memory only on web); "…" on everyone
  else's row in the Lobby and waiting room opens Report / Block (`MemberMenu`).
- **Tables from open PRs.** Friendships (0008) and groups (0012) are found with `to_regclass` at
  run time. Their block triggers are attached by `select private.attach_block_guards();`, which
  0014 runs. 0008 and 0012 are numbered lower, so `db reset`/CI always apply them first. A
  hosted database that gets 0008 or 0012 *after* 0014 must run that statement once (it is
  idempotent and returns which tables it attached).
- **Follow-ups (not built):** a web landing page for invite links (`https://…/i/TOKEN`) and
  Universal Links / App Links, so a link opens the app or the store when WTW isn't installed;
  a moderation view for reports; a "Blocked people" list in Profile (the data is readable via
  RLS today); a list of my invite links with Revoke (the route exists).

### Friend requests: what #24 calls (Razin, M4)

`_shared/api/friendRequests.ts` hardens `POST /friends/requests` (#24, not on main). #24's route
should be:

```ts
import { requestFriendSafely } from '../_shared/api/friendRequests.ts';
import { takeFriendRequestLimit } from './friendRequestLimit.ts';

app.post('/friends/requests', async (c) => {
  const { user, store } = await friends(c);
  return c.json(
    await requestFriendSafely(
      { takeFriendRequestLimit, request: (u, e) => store.request(u, e) },
      user.id,
      await readJsonBody(c),
    ),
  );
});
```

- The response is always `{ "status": "sent" }`, whether the email has an account, already sent
  you a request (0008 then accepts it), or blocked you. #24's store may keep throwing its 404
  `USER_NOT_FOUND`: the helper swallows it. #24's screen should say "If they're on WTW, they'll
  see your request" and refresh `GET /friends` rather than read a name from the response.
- 20 per user per day (`rate_limit_take(p_user_id, 'friend_request')`), checked before the
  lookup, so the limit also caps how many emails one account can test. Over it: 429 `RATE_LIMITED`.
- Unchanged: a bad email is 400 before anything; your own email is still #24's 400
  `CANNOT_FRIEND_SELF` (you know your own email, so it reveals nothing).

### Text filter (Razin, M4)

`_shared/domain/textFilter.ts` exports `textFilter(text) → { ok: true } | { ok: false, reason:
'blocked_word' }` (pure TS: Edge Function, Jest, app). `_shared/api/text.ts` exports
`requireCleanText(text, field)`, which throws 400 `TEXT_NOT_ALLOWED` ("That {field} isn't
allowed. Try different words.") and never echoes the word. Call it **after** the route's own
validation and **before** the store, on the trimmed value:

| Route (PR) | Call |
| --- | --- |
| `POST /me` display name (#22, and #29's copy) | `requireCleanText(displayName, 'name')` after `validateDisplayName` |
| `POST /groups`, `POST /groups/:id/rename` (#30) | `requireCleanText(name, 'group name')` after trimming, before `group_create` / `group_rename` |
| `POST /picks` custom options (#27, before `pick_create_options`) | `requireCleanText(option.name, 'option')` and, if present, `requireCleanText(option.note, 'note')`, for each option, before the RPC |
| `POST /hang` (#27) | `requireCleanText(activity, 'activity')` before `hangStore` writes `hang_posts` |

Main has no route yet that stores text other people see (reports are private), so nothing on
main calls it. The app can call `textFilter` to warn before sending, but the server check is
the one that counts. It is a word list (whole words, a few slurs matched inside words, phrases;
case, accents, zero-width characters, l33t, repeated and spaced-out letters), not moderation:
reports cover the rest. Tests: `tests/domain/textFilter.test.ts`, `tests/text.test.ts`.

### Delete my account (Razin, M4)

- `DELETE /me`: Bearer user access token, no body. Deletes the caller's account and all of their
  data and returns 200 `{ "status": "ok" }`; the app signs out afterwards. The user is always the
  verified token's user (a body or query naming someone else is ignored). 401 without a valid
  token, 500 `INTERNAL_ERROR` if Auth fails (nothing is deleted then), 503 if unconfigured.
  Code: `_shared/api/account.ts`, `api/accountStore.ts` (Auth admin API, service role only).
  Client: `api.deleteMe()` (Mike, PR #29). CORS allows `DELETE`.
- The API deletes the `auth.users` row; never the client. Postgres cascades to `profiles`, and a
  `BEFORE DELETE` trigger on `profiles` (`0017_account_deletion.sql`) applies these rules in the
  same transaction, so it is all or nothing and the dashboard's "Delete user" behaves the same:
  - Hosted Picks nobody else is in: deleted.
  - Hosted unfinished Picks (draft, swiping, final vote): `canceled`, with `cancel_reason` "The
    host deleted their account." and a `pick_canceled` inbox entry for each participant when
    0009 is applied.
  - Hosted completed (or already canceled) Picks: kept, with their results.
  - Kept hosted Picks get `host_id = null`. `GET /picks/:id` and `/progress` send
    `hostDeleted: true`; show the host as `DELETED_USER_NAME` ("Deleted user"). A hostless Pick
    is read-only: only `version`/`updated_at` and the FK set-null columns may change (PT409),
    and it can't be "picked again" (PT403). Constraint: a hostless Pick is completed or canceled.
  - Other people's Picks are never deleted; they lose this person's participant row, answers and
    ballot. Their candidates, ranking and winner stay.
  - Groups they own are deleted (their Picks stay, `group_id` null); memberships, friendships,
    saved places, notifications, push tokens, RSVPs/outcomes, hang posts/responses, the per-user
    rate-limit counter go. Custom options they typed stay in other people's Picks with the creator
    erased (`created_by` null, `createdBy` removed); ones no Pick uses are deleted.
  - Tables from unmerged PRs are found with `to_regclass` at run time, so any merge order works.
    One exception: 0017 relaxes 0015's creator constraints when it runs, so 0015 must be applied
    first. `db reset`/CI apply by number, so it always is; a hosted database that ran 0017
    before 0015 would fail deletions of custom-option creators (atomically) until re-run.
- Sessions: Auth revokes refresh tokens, and `getUser` rejects the old access token (401). An
  unexpired access token can still reach PostgREST until it expires, but RLS finds no rows for it.
- Fixed with it (`docs/bugs.md` #21): deleting any Auth user who was in a Pick failed.
  Tests: `supabase/tests/account_deletion_test.sql`, `app_test.ts` (DELETE /me),
  `tests/account.test.ts`, `tests/api/account.test.mjs` (`npm run test:api`).

Errors: `{ "error": { "code": "...", "message": "..." } }`.
400 invalid input, 401 invalid/missing token, 403 forbidden, 404 missing resource,
409 wrong state/concurrent change, 429 rate limited, 500 unexpected failure, 503 unconfigured backend.
Gateway errors before the function executes are controlled by Supabase.
To let the handler own authentication/error formatting and public health, `supabase/config.toml`
sets `[functions.api] verify_jwt = false`.
User mutation routes explicitly verify the caller through Supabase Auth.
The internal deadline sweep uses its own server-side secret, described below.

## Automatic deadline sweep (Josh, Week 3)

`POST /internal/sweep` (deployed path `/functions/v1/api/internal/sweep`) requires
`x-cron-secret` matching the Edge Function environment variable `CRON_SECRET`.
Missing/incorrect headers return 401; an unset/empty server secret returns 503.
It does not use user authentication. Keep `CRON_SECRET` server-only: never use an
`EXPO_PUBLIC_` variable or send it from the mobile app. Existing `verify_jwt = false`
lets this handler verify the secret itself; user routes retain their Auth checks.

Each invocation captures one cutoff time and queries IDs in pages of 100:

- `state = 'swiping' AND deadline_at <= cutoff` calls the existing
  `closePick(store, id, 'system', null)`.
- `state = 'final_vote' AND vote_deadline_at <= cutoff` calls the existing
  `closeVoteByDeadline(store, id)`.

Null/future deadlines are excluded. Alan's canonical functions recheck eligibility
and handle repeated calls/state races; the sweep does not rank, tally, choose winners,
or set deadlines. `deadline_at` is the swipe deadline; `vote_deadline_at` is the
separate final-vote deadline established when swiping closes.
Pagination uses the last ID rather than offsets so closing earlier rows does not
skip later rows. One Pick failure does not stop other Picks; a failed phase query
does not stop the other phase. Remaining eligible Picks are retried next minute.

Responses contain only `status` and per-phase `attempted`, `processed`, `failed`,
and `queryFailed` counts/flags. `processed` includes canonical safe no-ops and is
not a count of state changes. Success is HTTP 200 / `status: "ok"`; any per-Pick or
query failure returns HTTP 503 / `status: "partial_failure"` after attempting the
remaining work. IDs, ballots, credentials, and database error details are omitted.

### Cron and wtw-dev configuration

Migration `0005_deadline_sweep.sql` enables `pg_cron`, `pg_net`, and Supabase Vault,
adds partial deadline indexes, and schedules `wtw-deadline-sweep` every minute
(`* * * * *`). Its private, invoker-rights helper is revoked from app/service roles
and runs as the database owner that installs the migration. It reads Vault values
at execution time and uses `net.http_post`; no URL or secret is embedded in the
migration or cron command. This follows the
[Supabase scheduling/Vault pattern](https://supabase.com/docs/guides/functions/schedule-functions).

Required deployment setup, performed separately by a wtw-dev administrator:

1. Apply migrations through `0005` and deploy the updated `api` function, retaining
   `verify_jwt = false` and its existing server-side Supabase configuration.
2. Generate a strong random secret and set it as the Edge Function `CRON_SECRET`.
3. In Supabase Vault, create `wtw_cron_secret` with the same secret and
   `wtw_sweep_url` with the **actual** wtw-dev HTTPS endpoint, ending in
   `/functions/v1/api/internal/sweep`. Use the project Dashboard's Vault controls;
   do not commit values or paste credentials into logs.
4. Verify authenticated execution and inspect `cron.job_run_details` plus
   `net._http_response` for HTTP status/body. A successful cron SQL run only means
   the asynchronous request was queued, not that the sweep succeeded.

Until both Vault values are nonempty, the scheduled helper returns null and sends
no HTTP request, including in fresh local databases/CI. The endpoint URL must use
HTTPS and the exact deployed path. No service-role key is sent by cron. No GitHub
secret or CD change is required. Rotation requires updating both the Edge secret
and Vault value; mismatches fail closed. To pause, an administrator can run
`select cron.alter_job(job_id := (select jobid from cron.job where jobname =
'wtw-deadline-sweep'), active := false);`.

Focused Jest coverage: `npx jest --runInBand tests/sweep.test.ts tests/sweepStore.test.ts`.
Hono route tests extend the existing `api/app_test.ts`; run with Deno 2 using
`deno test --config supabase/functions/api/deno.json supabase/functions/api/app_test.ts`.
Mocks test orchestration and query arguments, not deployed HTTP, SQL locking,
Vault permissions, or real cron delivery; verify those in a configured Supabase environment.

## Database adapter (Razin + Josh)

`api/store.ts` uses only the server-side service-role client. Razin's migration
implements these operations against the committed schema. RPC execution is revoked
from PUBLIC, anon, and authenticated and granted only to service_role. Never accept direct mobile calls to these service-only operations.

1. `heartbeat_load_pick(p_pick_id, p_user_id)` returns null if absent, denies nonparticipants,
   otherwise returns one coherent JSON snapshot matching `PickSnapshot` in
   `_shared/api/heartbeat.ts`: id, hostId, state, center `{lat,lng}`, participantIds,
   candidates `[{placeId,lat,lng}]`, preferences `[{userId,placeId,value}]`, version.
   Candidate coordinates must come from the fixed Pick snapshots. Preferences must
   contain at most one value per participant/place, only for current participants.
   Use a single consistent database snapshot. `version` is an opaque string that changes
   on *every* ranking input change (including participants, candidates, preferences and state).
2. `heartbeat_upsert_swipe(p_pick_id, p_user_id, p_place_id, p_value)` locks the Pick,
   verifies membership, exact `swiping` state, candidate membership and 0/1/2 value,
   then upserts `preferences` on `(pick_id, place_id, user_id)` and advances the version
   in the same transaction. All other Pick writers must take the same lock/version discipline.
3. `heartbeat_save_ranking(p_pick_id, p_user_id, p_version, p_ranking)` locks the Pick,
   rechecks host + participant authorization, exact `swiping` state and matching version.
   Reject stale results with 409; no partial writes. In one transaction transition to
   `ranking`, replace this Pick's `ranking_results` with `p_ranking.rows`, then transition
   to `p_ranking.state`. For a clear winner set winner_place_id, decided_at, and
   decided_by = clear_winner. Otherwise clear winner metadata and enter final_vote.
   Rows contain place_id, rank, score, finalist; validate they match the fixed candidate pool.
   Roll back all changes on failure. Retrying after completion returns 409; client reloads.

RPCs raise SQLSTATE `PT400`, `PT403`, `PT404`, or `PT409` for expected errors.
Other database errors are masked as 500; missing RPCs (`PGRST202`) return 503.
Before enabling: test revoked direct writes/RPC access, foreign candidates, outsiders,
forged client user IDs, simultaneous rank/swipe, cancellation during ranking, retries,
and rollback on failed persistence with real Postgres.

`api/auth.ts` wraps Razin's shared `getUser` (`_shared/auth/getUser.ts`), which validates
the bearer token with Supabase Auth; no second auth system.
Alan's ranking/state/geo modules are reused unchanged. Mike's auth screens, seeded Pick
reader, swipe UI, API client and ranked result screen are in Mike's app (PR #2).

## Local HTTP/database tests (Phase 2)

Requirements: Node 22.13+ (22 LTS), Supabase CLI on PATH, and Docker with its daemon
running. Deno 2 is needed for the separate existing Edge unit/type checks. No hosted
project link, Google key, or GitHub/Supabase hosted secret is needed. The committed
`supabase/config.toml` already initializes this project; do not run `supabase init`.

From the repository root:

```sh
supabase start
supabase db reset --local
supabase test db
```

Reset destroys the local development database and reapplies migrations and seed.
The existing SQL suite runs its 39 assertions in a rolled-back transaction. It is
reused unchanged. In another terminal, start `supabase functions serve api`, then:

```sh
node tests/api/wait.mjs
npm run test:api
```

The integration runner reads `supabase status -o json` privately in memory and
rejects any API URL other than loopback on the configured port 54321. Never paste
status output into logs: it includes credentials. Tests create three disposable,
confirmed local Auth users and obtain genuine sessions through password sign-in;
this bypasses email delivery only for test fixtures and does not change application
OTP/auth configuration. Service-role access sets up isolated fixtures and checks
persistence; application actions use user bearer tokens through the served API.

Sequential HTTP scenarios cover health/auth rejection, outsider/non-host
isolation, swipe persistence/upsert and token-derived identity, invalid candidates,
canonical auto-close, post-close conflicts, and canonical final-vote deadline persistence.
Runtime-unique IDs avoid collisions; candidate data and expected outcomes are
deterministic. Fixtures are deleted in `finally`, including partial setup failures.
After interruption, reset locally before retrying. Stop the serving terminal and
run `supabase stop --no-backup` when finished. Do not run alongside a local reset.

Tests live under `tests/api/*.mjs`, use Node's built-in test runner/fetch, and add no
dependencies. Jest's existing TypeScript unit-test selection is unchanged. Responses
containing Auth credentials are never included in assertions or logs; failed HTTP
operations report only their label and status. Each request and the overall suite
have time limits; API readiness is bounded to approximately 100 seconds.

CI retains the existing validation job and adds one independent integration job:
Docker check → local Supabase start → reset → existing pgTAP → serve/readiness →
HTTP integration tests. Steps and the job have timeouts; failures propagate normally.
Cleanup runs even after failures. CLI startup/reset/function output is kept in private
temporary files, never uploaded or printed, then removed; failure diagnostics expose
container names/status only. The job uses Supabase setup-cli's current stable release
(`latest`); it needs no npm install because the HTTP tests use only Node built-ins.
CLI installation follows [Supabase setup-cli](https://github.com/supabase/setup-cli).

Lifecycle create/start/refresh/cancel/read and canonical close/vote routes are
present. The HTTP integration harness now verifies persisted auto-close after the
final swipe, post-close conflicts without mutation, and canonical tied `/close`
with a future vote deadline unchanged on retry. It is not exhaustive coverage of
every lifecycle route or a real cron delivery test. Join remains outside this
implemented route set. Unit/route tests supplement the database/API harness.

## Read-time opening hours

The existing authenticated `GET /picks/:id` adds `candidateHours` metadata for
`completed` and `final_vote` Picks. Membership is checked before provider access;
responses use `Cache-Control: private, no-store`. The frontend uses `api.getPick()`
to read candidates and hours together. Its adapter preserves candidate order and
fields, merging matching `candidateHours` metadata into `openNow` and `closesAt`.

The read uses `refreshOpenHours` through a provenance-aware adapter. Explicitly
Google-tagged candidates fetch current hours using the server-only
`GOOGLE_PLACES_API_KEY`; no Google hours are cached or written to the database.
Fresh explicitly mock-tagged snapshot hours are validated with the helper's
seven-day freshness rule. Stale, missing, untagged legacy/demo hours, provider
errors, and timeouts produce unknown hours, never an invented open/closed status.
The current fixtures have no authoritative hours source. Discovery mode changes
never relabel an existing candidate or send a mock ID to Google.

Hours failures do not replace candidates or alter winner, ranking, votes, snapshots,
or Pick state. Swiping/draft reads do not fetch hours. The Pick response retains
candidates when optional hours metadata is unavailable. Google candidate creation and
full display hydration remain blocked on the separate persistence design; this
read path does not enable Google lifecycle discovery or authorize Google snapshots.

## Main to wtw-dev deployment

**IMPLEMENTED; not hosted-tested.** PR CI passes and the deployment job correctly
skips on pull requests. A successful hosted main deployment is still outstanding.

The implemented CI workflow is configured to deploy the backend only on a push to `refs/heads/main`,
after **both** `validate` and `integration` succeed. Pull requests never execute the
deployment job. It checks out the exact validated commit and uses the same
`supabase/setup-cli@v1` / `latest` CLI setup as local integration CI.

Configure the GitHub environment **wtw-dev** manually before enabling deployments:

| Name | GitHub environment setting | Purpose |
| --- | --- | --- |
| `SUPABASE_ACCESS_TOKEN` | Secret | Supabase CLI authorization with access to link/deploy wtw-dev |
| `SUPABASE_DB_PASSWORD` | Secret | wtw-dev database password |
| `SUPABASE_PROJECT_REF` | Variable | Actual hosted wtw-dev project reference |

Restrict that environment's deployment branches to main. Required-reviewer rules,
if enabled, introduce a manual approval gate; omit that gate for fully automatic
main deployments. Never use the local `config.toml` project ID as the hosted ref.
Confirm hosted migration history matches the repository before the first run.
These values are not configured by the workflow.

Deployments share a `wtw-dev-backend-deploy` concurrency group with
`cancel-in-progress: false`. Inside that lock, the job checks the current remote
main SHA and skips superseded revisions, including old reruns. This favors the
latest main revision over deploying every intermediate merge. A main update during
an active deployment does not interrupt it; the newer successful run deploys next.
If the newer revision fails CI, it is not deployed. The guard prevents a slow older
queued run from overwriting a newer deployed revision during normal forward main
history; avoid force-pushing main.

Commands execute in this order:

```sh
supabase link --project-ref "$SUPABASE_PROJECT_REF"
supabase db push --linked --yes
supabase functions deploy api --project-ref "$SUPABASE_PROJECT_REF" --yes
```

Migrations precede the function because its code may require new schema/RPCs.
Only pending migrations are applied: no hosted reset, seed, automatic history
repair, or general project-config push runs. The function deployment reads the
existing `[functions.api] verify_jwt = false` configuration; application user-auth
and internal cron-secret checks remain responsible for route authorization.

Each failure stops subsequent deployment steps and fails the job. CLI output is
redirected to a restricted temporary log, never printed or uploaded, and removed
in an always-run cleanup step. Logs report only which stage failed. No shell tracing
or CLI debug mode is used; credentials are supplied through environment variables.
The deployment job has a 15-minute timeout.

If migrations succeed but function deployment fails, the database changes remain;
there is no cross-service transaction or automatic rollback. Keep migrations
backward compatible with the previous function. Fix the cause and rerun the failed
job if that commit is still main; otherwise deploy a corrective main commit after
CI passes. Recorded migrations are skipped on retry. For schema defects use a new
forward-fix migration; never edit applied migrations or reset hosted data. An
administrator must inspect hosted migration/function status when diagnosing a
failure; a green local test is not proof that a hosted deployment worked.

`CRON_SECRET` belongs in hosted Edge Function secrets. Vault entries
`wtw_cron_secret` and `wtw_sweep_url` are configured separately by the hosted project
administrator, as described above. CD does not create, rotate, or overwrite them.
Provider configuration is also outside this deployment workflow. Successful CD
establishes command completion, not end-to-end cron delivery or live provider health.

### Looking to hang — integration 0022

- POST /hang retains the existing activity/audience/group/start/expiry body; group
  posts require current group membership. GET /hang now returns up to 20 visible
  active posts (own, accepted friends, current group members), with myStatus,
  downCount and pickId. sharedAvailable is true. Both-direction blocks exclude posts.
- POST /hang/:id/respond {status: down|maybe|cant} rechecks visibility/expiry and
  upserts one row per user/post. Hidden/missing/expired posts return 404.
- POST /hang/:id/pick accepts the same settings body as POST /picks; caller must
  be the Hang author. It calls canonical pick_create_options under the post lock,
  selecting only current eligible downs. If the author is not down, the first
  eligible down UUID hosts; no implicit author membership. Returns {pickId,isParticipant}.
  The existing New Pick form collects location/category/filter/custom settings;
  Hang startsAt becomes plan_at. Notification recipients are exactly the included
  participants, using the existing deduplicating notifier.
- No eligible down: 409 NO_DOWN_RESPONSES. Non-author visible caller: 403; hidden
  post: 404. Unchanged draft: reuse without spending create quota again. Changed
  draft participants or running Pick: 409; cancel first. Finished/canceled allows
  another Pick. Current eligibility is checked again on creation, not inferred
  from stale responses. Membership thereafter follows normal Pick snapshot rules.
- Service-only RPCs: hang_create/list/get/access/respond/create_pick. Client writes
  remain revoked. Responses are readable only by the responder or Hang author,
  while eligible. Migration 0022 adds the Pick link and group FK without destructive
  cleanup of legacy rows. Existing Pick/swipe/rank/vote RPCs are reused unchanged.

## Group Ideas (0023)

Unscheduled ideas belong to exactly one existing group. The group detail screen uses:

- `GET /groups/:id/ideas` → `{ ideas: GroupIdea[] }`, newest first, UUID tie break.
- `GET /groups/:id/ideas/:ideaId` → `GroupIdea`.
- `POST /groups/:id/ideas` → 201 `GroupIdea`.
- `POST /groups/:id/ideas/:ideaId` → updated `GroupIdea` (full editable-field replacement, following existing POST mutation conventions).
- `DELETE /groups/:id/ideas/:ideaId` → `{ status: 'ok' }`.

Bodies: `{ name, category: 'activity' | 'food', description?, locationText? }`.
Name is trimmed, 1–60 Unicode characters; description and location are optional,
trimmed, at most 200 each; empty values become null. All visible text uses the
existing text filter before persistence. IDs, creator and timestamps are server-owned.
Responses add `id`, `groupId`, `createdBy`, `createdAt`, `updatedAt`.

Every operation requires current group membership; missing/nonmember groups and
cross-group idea IDs return 404. Only the creator edits. The creator or group owner
may delete, including ideas left by former members. Removed creators lose access.
RLS permits current-member reads only; clients cannot write or invoke the service-only
`group_ideas` RPC. The RPC takes the existing group lock before checking membership
and modifying ideas. Deleting a group or creator cascades ideas. Mock mode follows
these same rules. Edits use last successful write wins, as existing group renames do.

Deploy migration 0023 before the updated Edge Function/client. No existing custom
options are converted: `picks.custom_options`, `custom:<uuid>` candidates, Pick Again
and existing histories keep their contracts. Group Ideas stay outside provider caches
and the Discover feed. Pick inclusion is
explicitly opt-in; see the deck contract below. No image bucket/upload policy exists, so images are deferred.


## Group Ideas in Pick decks (0024)

The group creation form has a default-off **Include Group Ideas** switch beside saved
places and discovery filters. `POST /picks` accepts `includeGroupIdeas?: boolean`;
true requires a valid `groupId` and current host membership. `picks.include_group_ideas`
defaults false for old/new Picks. `GET /picks/:id` returns `includeGroupIdeas` and
`groupId`. Non-group Pick configuration cannot enable this option.

The form also offers `category: 'both'` (Food + activities). Existing Food, Activities
and Custom contracts remain supported. Both calls the existing food and activity
provider searches separately (and therefore can consume two capped provider calls),
round-robins their results and keeps each place's actual category in storage.

Decks are built at **start**, not draft creation. OFF never retrieves ideas. ON
resolves current group ideas via the member-authorized store, generates the ordinary
provider pool with the same filters, then mixes matching ideas into that pool.
Food matches `food`, Activities matches library `activity`, Both allows both. Legacy
Custom uses its mix category, or both idea types when no provider mix is selected.
Radius, price and Open Now apply to provider/saved-provider places, not group ideas:
ideas have no provider prices/hours/coordinates. No library idea enters Discover.

The configured `poolSize` remains the total deck bound (maximum 30). Typed options
retain their slots. Remaining slots alternate ideas and ordinary candidates, starting
with an idea; the library is ordered newest first then UUID. Not every idea fits a
large library. Custom opt-in creation uses a 30-card capacity; API callers must leave
at least one free slot beyond typed options. Zero matching ideas leaves the public
pool intact. If public results are empty, eligible ideas can still form the deck;
if everything is empty, the existing 409 NO_CANDIDATES applies.

Snapshots use `custom:<fresh uuid>` per build, `provider/source: 'custom'`,
`origin: 'group_idea'`, `groupIdeaId`, `groupId`, creator, frozen name, description
(`note`) and location text (`address`). These are explicit provenance fields, not
name parsing. No live FK to the library is added. New IDs prevent a refresh or a
new Pick from overwriting historical places/snapshots. Clients preserve provenance
and show **Our Idea** on swipe/finalist/winner cards. Google enrichment is skipped.

Coordinate-free ideas reuse the legacy custom contract: numeric center coordinates
satisfy canonical DB/ranking inputs, with `locationProvided: false`. The app exposes
null coordinates, no distance and no Directions. The existing ranking algorithm is
unchanged, including its custom neutral-point (zero-distance) tie-break behavior;
these internal coordinates never claim an actual idea location.

Start/refresh rechecks host membership and idea/group/category provenance under the
same group lock before committing the deck. A library entry deleted between lookup
and commit fails safely (400); retry rebuilds from the current library. Edits/deletion
**after** deck commit do not affect swipes, votes, winners or history. Explicit refresh
replaces the deck using current library content and the existing answer-reset/confirm
rules. Pick Again carries the opt-in and current membership, reuses an existing draft,
and resolves current ideas at its own start. If the host left or the group disappeared,
the new Pick disables idea inclusion. Existing account-deletion redaction still applies.

Apply migration 0024 before deploying the API/client. The migration wraps canonical
lifecycle/Pick Again functions and adds authorization checks; ranking, voting,
notifications and provider retention restrictions are unchanged. Service-only helpers
stay in the private schema. Mock mode uses the same category, snapshot and mixing
helpers and existing group graph.


## Direct group invitations (0025)

Direct requests now require recipient consent. Existing groups/members are unchanged.
`group_invitations` stores UUID id/group/inviter/invitee, pending/accepted/declined
status and created/resolved timestamps. A partial unique index allows one pending
invite per group/recipient. Group and inviter/invitee deletion cascade these rows.
There is no new auth system and no link-token storage duplicated in this table:
`invite_links` remains the separate bearer join mechanism.

- `POST /groups/:id/members { userIds }` creates pending invitations, never members.
  `{ invited, added: 0 }` reports newly created rows; repeat sends reuse pending IDs
  and return zero newly invited. Existing client helper `addGroupMembers` and SQL
  `group_add_members` remain compatibility names with the new consent semantics.
- `GET /group-invitations` → `{ invitations }`, only the authenticated recipient's
  currently eligible pending requests, with group/inviter display names.
- `GET /groups/:id/invitations` → `{ invitations }`, current owner only, pending
  outgoing requests. Ordinary members cannot browse other people's invitations.
- `POST /group-invitations/:id/respond { decision: 'accepted' | 'declined' }`
  → resolved invitation. Body user IDs are ignored; the recipient is always the
  verified caller. Unknown/foreign/ineligible requests return 404.

The owner remains the only inviter (the model has owner/member roles, no admins).
Inviter and invitee must still be accepted friends and unblocked in either direction.
The API and RLS hide invitations after a block, friendship removal or invalid group.
Only relevant recipient/owner rows are readable; clients cannot write or call service
RPCs. All invitation writes lock the group before the invite, serializing concurrent
sends, capacity checks, membership changes and duplicate response taps.

Acceptance rechecks eligibility and capacity, inserts only the caller if not already
present, and marks accepted/resolved atomically. Already joined through a bearer link
is an idempotent no-extra-membership case. Decline records declined/resolved without
inserting or removing membership. Repeating the same successful decision returns its
existing result; an opposite decision returns 409 INVITE_RESOLVED. An old accepted
invite cannot re-add someone after they leave/are removed (409). A full group returns
409 GROUP_FULL and retains pending status; acceptance may be retried when room opens.
Pending requests do not reserve seats. A new invitation may be sent after decline;
it has a new ID. No expiry/revocation dashboard is introduced.

Friends displays Group invitations above the Friends/Groups content, using existing
request cards and Accept/Decline buttons. Owner group detail says Invite/Pending and
shows an outstanding count. Existing notify()/push transport sends a generic
`group_invite` event with only `{ inviteId }` in the inbox payload. Names are fetched
from the protected invitation list, never embedded in lock-screen text. A per-invite
unique index deduplicates inbox rows/pushes, including resend retries. Responding marks
the corresponding notice read. Notice taps open Friends; stale notices have no power
to grant membership. Pending requests remain visible if push delivery fails.

Pick six-character codes and POST /picks/:id/invite are unchanged. Existing
`wtw://i/TOKEN` bearer links still request their established join/accept path when opened;
group links can add the opener immediately after authentication, subject to their
existing expiry/use limits/blocking checks. This deliberate bearer-link behavior is
distinct from sending a direct recipient invitation. Receiving a direct request never
runs that path. Group Ideas and new group Picks remain member-only until acceptance;
acceptance does not retroactively add anyone to existing Picks.

Deploy 0025 before the updated API/client. The API calls the new `group_invite_members`
RPC so a missing migration returns 503 rather than falling back to old immediate-add
behavior. Mock mode shares these decisions, current graph checks, retries/capacity and
cascades; its Weekend crew fixture demonstrates an invitation before membership.

## Friend profiles and metadata privacy (0026)

`GET /users/:id/profile` returns a fixed, authenticated projection of a user profile.
Only the owner or an accepted, unblocked friend may read it. Pending requests,
unrelated users, deleted profiles and blocks in either direction return the same
404 PROFILE_NOT_FOUND, including when users share a group or old Pick.

`GET /me/details` reads the caller's own full projection. `POST /me/details` replaces
only `{ username, favoriteCuisine, favoriteActivity, shareMetadata }` for the verified
caller. Body IDs, avatar, counts, preferences and privilege fields cannot change the
update target. The legacy GET/POST /me, preference survey and onboarding are unchanged.

Response fields: `id`, `displayName`, `username`, `avatarUrl`, `isOwner`,
`metadataVisible`, `friendsCount`, `groupsCount`, `favoriteCuisine`, `favoriteActivity`,
`mutualGroups: [{id,name}]`. Only the owner also receives `shareMetadata`.
Email, Discover preferences, hidden metadata and non-mutual group names are never
included in the friend-profile projection. Hidden scalar metadata is null, mutual
lists are empty; zero counts remain zero. Responses are private/no-store.

Migration 0026 adds nullable username/favorites and a default-false metadata sharing
flag to profiles. New fields have no authenticated/anonymous direct SELECT grant;
service-only RPCs explicitly check the current graph and whitelist fields. Existing
basic-identity RLS/column grants for friend requests/groups/Pick history stay intact.
The existing avatar_url is reused read-only; no upload/storage infrastructure or
arbitrary image URL setter is introduced. Missing photos use the current Avatar fallback.

Usernames are optional for compatibility: no email-derived backfill or new onboarding.
Updates trim, remove one leading @ and lowercase; valid usernames are 3–24 ASCII
letters/digits/underscores. A database unique index on lower(username) enforces races
and case-insensitive uniqueness; collisions return 409 USERNAME_TAKEN. Clearing a
username or deleting the account releases it. Favorites are optional one-line text,
up to 60 Unicode characters. The existing text filter moderates all edited text.

One **Share profile metadata with friends** switch controls both counts, both
favorites and mutual groups together. Default off: friends see only name, username
and available avatar. Owners always see their own full data. Counts use accepted,
unblocked friendships and current group_members rows (pending invitations do not
count). Enabling sharing explicitly shares the aggregate group count, including groups
not shared with the viewer; their names/IDs remain private. Mutual groups require both
users to be current members and are hidden with the rest of metadata when sharing is off.
Existing account deletion cascades profile data; auth/provider behavior is unchanged.

Friends rows open `/users/[id]`, with their existing secondary action kept separate.
The current Profile tab displays the same avatar/username/counts/favorites and adds a
small details/privacy sheet; the existing name editor and settings remain. There is
no public directory, username lookup, messaging or profile feed. Mock mode uses the
same parser/projection shape, accepted friendships, current group membership and blocks.
Its third-party friend counts reflect only known mock friendship edges, not invented
friend lists. Apply migration 0026 before the updated API/client.

## Settings and blocked-user list

The authenticated `/settings` Stack page replaces Profile's partial Settings sheet.
`/settings/profile` reuses the existing display-name API/context and metadata/privacy
editor; `/settings/blocked` lists and unblocks users. Existing Profile shortcuts stay
available. Display name and metadata have separate save actions, with no new profile
schema or multi-field atomic-save claim.

`GET /blocks` → `{ users: [{ userId, displayName }] }`, private/no-store, authenticates
before reading. The service adapter filters blocks by the verified caller's blocker_id
then resolves only those IDs' basic display names. It never returns reverse blocks,
email, usernames, favorites or other private profile metadata. No client-supplied user
ID selects the list. Existing POST /blocks/:userId/remove handles unblock idempotently;
unblocking does not recreate friendships, group membership or access to friend profiles.
No migration or RLS grant change is needed; blocks already has owner-only reads and
service writes. Mock GET/list/unblock follows the same caller-owned shape and semantics.

Notification settings expose the real inbox, permission state, explicit permission
request/device registration, and native system-settings link. There is no server
per-category preference model and no fake toggle. Permission granted is distinguished
from successful push registration; failed/unavailable registration points to the inbox.
Location shows foreground permission status, never asks permission or reads coordinates
on entry, and offers a native settings link. Status refreshes on focus/foreground.
Web offers informational guidance, with no unsupported native permission actions.

Profile and Settings share accountActions: logout attempts push-token cleanup then uses
the existing auth service; account deletion confirms, awaits DELETE /me, then signs out.
Cancellation/failure never signs the user out prematurely. Duplicate actions serialize;
SDK signout errors are surfaced. Auth changes continue through useAuth and protected
routes. No deletion backend or auth-provider behavior was redesigned.

Contacts integration, password auth, published Terms and Privacy Policy do not exist
in this repo and are omitted. Help is local usage guidance, not a feedback submission
service. Data & privacy information is an explicitly informational summary of the
current inventory/controls, not fabricated legal policy. Device permission/push and
account actions still need a native smoke test; no schema migration is required.

### Auth identity and optional setup (0027)

Deploy `0027_auth_identity_setup.sql` before the updated API/client. GET `/me` adds
`username: string|null` and `optionalSetupPending: boolean`; legacy `onboarded` retains
its Discover-survey meaning and no longer gates navigation.

- POST `/me/identity` `{displayName, username}` validates existing text rules and saves
  both atomically for the verified caller. Username normalization/uniqueness reuse 0026.
  Returns the caller's full UserProfile; 409 `USERNAME_TAKEN` leaves both fields unchanged.
- POST `/me/optional-setup` dismisses the optional offer, returning
  `{optionalSetupPending:false}`. Repeated calls are harmless; this is independent of
  identity access and does not change preferences or permission settings.
- Existing `/me`, `/me/details`, `/me/preferences`, logout and account deletion contracts
  remain available. Optional favorites use existing `/me/details` fields and preserve
  username/privacy. New RPC execution remains service-role only; no RLS/grants weakened.

Email Log In disallows account creation; Sign Up explicitly permits it. Hosted email
provider/SMTP and an OTP email template containing the token must be configured and tested
for actual delivery. The app still verifies email codes, without password or OAuth UI.
See `decisions.md` for deferred provider setup and legal publication requirements.

### Group chat (0028)

Deploy `0028_group_chat.sql` before the API/client. `group_messages` contains UUID id,
group_id, sender_id, body (1–1000 code points), created_at, and an opaque client_id for
retry deduplication. The unique `(sender_id, client_id)` index makes retries safe. All
writes use the service-only `group_chat` RPC, sharing the membership-mutation group lock.
Client table reads have member/block-aware RLS; clients have no write grants/RPC access.

- GET `/groups/:id/messages` → `{messages: GroupMessage[]}`. Latest 50 visible messages,
  chronological `(created_at,id)` order, private/no-store; older-page navigation is omitted.
- POST `/groups/:id/messages` `{body,clientId}` → 201 `GroupMessage`, including on a
  successful retry. clientId is 8–100 ASCII letters/digits/underscores/hyphens and must be
  reused for a network retry. Different content/group under the same sender/clientId gets
  409 `MESSAGE_CONFLICT`. Sender/group fields in the body convey no authority.
- Body is trimmed, validated, and passed through the existing text filter. API responses
  include basic sender identity/avatar, never profile counts, favorites or privacy fields.
- Nonmembers, pending invitees and removed members get 404 `GROUP_NOT_FOUND`. Historical
  messages survive leaving/removal. Blocking does not eject existing shared group members;
  instead messages/notifications between the blocked pair are suppressed in both directions.
- Group deletion cascades messages. Account deletion removes that sender's messages; owner
  deletion also cascades the owned group. Linked chat inbox rows cascade with message deletion.

The existing `notify()` writes inbox rows and delivers generic Expo pushes. Chat adds a
`group_message` type, per-message/per-recipient uniqueness and a FK to its message. The
notification RPC rechecks current membership/blocking, excludes the sender and stores only
message/group IDs. Existing generic notices may remain after removal/blocking; opening them
never bypasses chat authorization. Existing OS notification permissions and registered-token
behavior apply; there is no per-group mute setting. Delivery is best effort, like Pick events;
no new outbox or push infrastructure was introduced. Inbox/push taps open the group's Chat.

`0028` adds messages to an existing `supabase_realtime` publication. Chat listens for INSERTs,
then rereads the authenticated API. A 5-second foreground/focused poll also verifies current
membership/blocking and recovers when Realtime is unavailable. No requests run in background;
blur/background clear displayed chat. Failed reads clear cached messages; 401/403/404 disable
sending until explicit retry/reentry. Test hosted publication/RLS, socket reconnect and push
with two signed-in devices; standalone SQL verifies policy/publication wiring, not delivery.

Mock chat uses the same parsers, member checks, history bound/order, blocking and retry rules.
Its emitter invalidates history without a network connection; simulated other-member sends
produce deduplicated inbox notices for the fixture user. Group reset/delete and account-delete
cleanup cover chat, while leaving/removal preserve history. Mock data remains in-memory.

### Friend direct messages (0029)

Deploy `0029_direct_messages.sql` before the API/client. `direct_conversations` holds exactly
one ordered UUID pair (`user_low < user_high`, unique pair), and `direct_messages` holds
conversation_id, sender_id, body, created_at and the same client retry ID used by Group Chat.
Indexes cover recent messages, pair lookup, sender deletion and notification cascades.

- POST `/conversations` `{userId: friendId}` opens/reuses the canonical pair and returns
  `{id,createdAt,peer:{id,displayName,username,avatarUrl}}` (200 for new or existing).
- GET `/conversations/:id/messages` returns `{conversation,messages}` with the latest 50
  messages in chronological `(created_at,id)` order and private/no-store cache headers.
- POST `/conversations/:id/messages` `{body,clientId}` returns the message (201, including
  successful retry). The existing trimmed 1–1000-code-point validation/text filter is shared
  with Group Chat. Changed content/conversation under the same sender/clientId returns
  409 `MESSAGE_CONFLICT`; sender IDs in a body are ignored.

All actions recheck pair participation, two available profile rows, accepted friendship and
both block directions. Profile key-share locks and a friendship row lock serialize DM actions
with account deletion and the existing unfriend/block writers. Clients have read-only RLS
access and cannot invoke the service RPC. Outsiders, pending requests, missing accounts,
unfriended pairs and blocked pairs receive 404 `CONVERSATION_UNAVAILABLE`, without disclosing
which eligibility condition failed. Basic peer identity is returned, never private favorites,
counts or mutual groups.

Unfriend/block retain messages but revoke all read/send access. Unblocking does not restore
friendship. A newly accepted friendship can reopen the same conversation and retained history;
a pending re-request cannot. Hard account deletion cascades the entire two-person conversation
and its messages/notices, including the surviving participant's messages in that conversation,
so no conversation with a deleted participant or orphaned access remains.

`direct_message` notifications reuse notify/inbox/Expo push: only the other participant is
notified; the notification RPC rechecks friendship/blocking and deduplicates per message.
Payloads contain conversation/message IDs only, and push text is generic. Inbox and push taps
open `/messages/:id`. Old generic inbox rows may remain after unfriend/block, but opening them
still requires current eligibility. Current device/OS permission and token behavior applies;
no new mute/preferences infrastructure is implied. Delivery remains best effort.

Group Chat and DMs now share only validation, the thread/composer UI, and the Realtime/polling
lifecycle. Existing Group Chat exports and behavior remain compatible. INSERT invalidations
reread the API, with five-second focused foreground checks for friendship/block changes and
fallback recovery. Blur/background/error clear private history/peer data. A known authorization
failure disables sending until retry/reentry; DMs also wait for an authorized initial history
read before enabling the composer. The migration joins an existing Realtime publication.

Friends rows keep their profile tap and remove action, adding a separate Message icon. Eligible
friend profiles have a Message button; own profiles do not. Existing inbox DM notifications
provide conversation reentry; no separate conversations dashboard was added. Mock mode uses
current accepted fixture friendships/blocking, canonical pair reuse, retries, bounded history,
an invalidation emitter, recipient notices and deletion cleanup. It remains an in-memory
single-user fixture environment. Verify two-device delivery/revocation/reconnect and keyboard
behavior in development/store builds; standalone SQL cannot validate hosted sockets or push.

### Past Moves from existing plans (0030)

Past Moves are a bounded read projection of existing `picks`, `pick_candidates`,
`pick_participants` and per-user `pick_outcomes`. There is no post table, duplicated history,
new attendance flag or upload model. Deploy `0030_past_moves.sql` before the API/client: it
adds the service-only `profile_past_moves(viewer,target,group)` projection and a partial
attended-outcome index. Existing outcome RLS remains own-row-only; no table grants weaken.

- GET `/me/past-moves?groupId=…` reads the caller's eligible records, optionally using the
  same current-group-member filtering rule as group History.
- GET `/users/:id/past-moves` returns `{visible,pastMoves}` for a profile. Every route derives
  the viewer from authentication and uses private/no-store caching. Nonfriends/blocked or
  missing profiles return 404; a friend's hidden metadata returns `{visible:false,pastMoves:[]}`.
- A record requires a completed Pick with a frozen winner, subject participation, an explicit
  `went=true` outcome for that subject, and the existing UI delay: at least one hour after
  `plan_at`, or three hours after `decided_at` for an untimed Pick. A decided winner or another
  participant's confirmation alone never creates a personal memory. Early API answers remain
  valid under the existing outcome contract but do not qualify until this delay passes.
- The latest 50 are ordered by stored occurrence time descending, then Pick ID. `occurredAt`
  is plan time or untimed decision time, not proof of an exact physical completion time.
  `confirmedAt` is the caller's last outcome-answer timestamp; it is null for friend projections.
  Existing plan-time changes can move eligibility/date; these derived views do not create an
  immutable schedule copy. Existing RSVP, outcome updates, Pick Again and reminders are preserved.

Owner views ignore the profile-sharing flag and include remaining participant/confirmed counts.
Friend views require accepted friendship, no block in either direction, the existing
`share_profile_metadata` opt-in AND original participation in that same Pick. Thus sharing
metadata never gives a friend access to a new/private plan. Friend cards omit participant
identities, counts and response timestamps. Group ID/name appear only if the viewer is a
current member; otherwise they are null, including after group deletion. The privacy-control
explanation now explicitly includes confirmed Past Moves from shared Picks.

Winner name/address/provenance are read from the frozen candidate, never a live Group Idea,
place lookup or Google request. Group Idea edits/deletion therefore do not rename past events.
Legacy Google/request-only snapshots are reduced to ID plus a generic UI title: no retained
Google name, address or photo is displayed/hydrated by this feature. The existing conservative
provider retention boundary remains unchanged.

History keeps one card per completed Pick and adds a personal Past Move badge/date when eligible.
A Past Moves API failure does not break normal History. Profiles show five cards initially,
expandable within the 50-row bound. Cards open the existing Pick route, already authorized by
original participation. `Did you go?` wording is explicitly personal, with an attendance-update
control; an RSVP of not-going does not prevent an explicit later attendance correction.

Deletion follows existing FK/trigger behavior: user attendance/profile visibility disappear;
completed shared Picks and frozen custom/idea content survive for remaining participants.
Group deletion clears `picks.group_id` and retains Pick history without a group label. Counts
reflect surviving records, matching existing History. No additional attendance is inferred.
Mock mode mirrors eligibility, projection/privacy, frozen winners, updates and own-attendance
cleanup; its plan state remains in-memory like existing demo data.

Photos are deferred: no configured bucket, upload/picker pipeline, signed media access policy
or photo ownership model exists. The stable Pick ID is the extension point for a future
attachment model after upload limits, access/deletion policy and provider restrictions are
reviewed. No fake media controls, empty photo grids or public feed were added.

### Branch integration corrections (0031)

Migration 0031 keeps legacy nullable usernames but rejects clearing an established username
through metadata/privacy updates (400). Normal rename/uniqueness semantics and service-only
RPC permissions remain. The client and mock apply the same rule; no endpoint shape changes.

Groups now share the root required-identity guard. Auth restoration yields to newer auth events;
late profile writes cannot update another account's context. Group details, Ideas, invitations,
friend profiles and Past Moves revalidate every five seconds only while focused/foreground,
clear on blur/background or failed authorization, and ignore superseded reads. Group detail
polls avoid repeatedly loading the friend picker when membership has not changed. PlanBlock
keeps its 30-second interval but pauses off-screen/background and clears on authorization denial.
Chat ignores obsolete pre-background errors so foreground revalidation can recover. Server-side
revocation remains immediate; remote UI changes appear on the next foreground check. Mock
account deletion now cascades owned groups/current memberships and linked group content while
preserving historical Pick associations for surviving groups.

Shared Screen Back uses the existing stack when available and otherwise replaces with Picks,
so a cold-start group/profile/message/settings/history route has a working exit.

### PR #51 username discovery contract (0036 + 0037)

Supersedes the legacy email-add and no-directory descriptions above. Apply 0036 and
0037 before deploying the new API. Authenticated GET /friends/search?q=prefix and
GET /people/:UUID expose basic identity, relationship, and separately authorized avatar
metadata only; both share 30/UTC-minute and 150/rolling-24-hour quotas (429). Search is
bounded to ten results, usernames are discoverable by default, and blocking/deletion
restrictions apply. POST /friends/username-requests binds username to targetId and
returns {status:'sent',relationship:'requested'|'friends'} only after a valid atomic
write/idempotent confirmation. Missing, stale, deleted and blocked targets return the
same unavailable error (404); self is 400. Friend-request accounting is inside this RPC.
POST /friends/requests is retired: all authenticated bodies return 410
EMAIL_REQUESTS_RETIRED without an email lookup. Historical pending requests remain
acceptable but their email-created outgoing state is not exposed by discovery.
