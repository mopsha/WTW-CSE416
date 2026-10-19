# WTW Design Document (M2)

Sections are owned by the person named in each heading. Fill yours in on your own branch.

## Data model (Alan)

Postgres (Supabase) is the source of truth. Clients read through RLS; **only our API writes** (service role).
Columns below are the ones the decision engine relies on; Razin's migration is authoritative for the rest.

```mermaid
erDiagram
    profiles ||--o{ friendships : "has"
    profiles ||--o{ group_members : "belongs to"
    groups ||--o{ group_members : "has"
    groups |o--o{ picks : "started from"
    profiles ||--o{ picks : "hosts"
    picks ||--o{ pick_participants : "has"
    profiles ||--o{ pick_participants : "joins"
    picks ||--o{ pick_join_codes : "invites via"
    picks ||--o{ pick_candidates : "pool"
    places ||--o{ pick_candidates : "appears in"
    places ||--o| place_cache : "cached as"
    pick_candidates ||--o{ preferences : "rated in"
    profiles ||--o{ preferences : "gives"
    picks ||--o{ ranking_results : "ranked as"
    places ||--o{ ranking_results : "ranked"
    picks ||--o{ final_votes : "voted in"
    profiles ||--o{ final_votes : "casts"
    places |o--o{ picks : "wins"
    profiles ||--o{ notifications : "receives"
    profiles ||--o{ push_tokens : "registers"
    profiles ||--o{ saved_places : "saves"
    places ||--o{ saved_places : "saved"

    picks {
        uuid id PK
        uuid host_id FK
        uuid group_id FK "nullable"
        pick_state state "draft|swiping|ranking|final_vote|completed|canceled"
        text category "food|activities"
        float center_lat
        float center_lng
        int radius_m
        timestamptz deadline_at
        int close_threshold "percent, default 100"
        text winner_place_id FK "nullable"
        timestamptz decided_at
        text decided_by "clear_winner|vote"
    }
    pick_participants {
        uuid pick_id FK
        uuid user_id FK
        timestamptz finished_at "nullable"
    }
    pick_candidates {
        uuid pick_id FK
        text place_id FK
        jsonb snapshot "place data shown during this Pick"
    }
    preferences {
        uuid pick_id FK
        text place_id FK
        uuid user_id FK
        smallint value "0=No 1=Maybe 2=Yes; unique per pick+place+user"
    }
    ranking_results {
        uuid pick_id FK
        text place_id FK
        int rank "shown to users"
        float score "never shown; tests and debugging"
        boolean finalist
    }
    final_votes {
        uuid pick_id FK
        uuid user_id FK "one vote per participant"
        text place_id FK "must be a finalist"
    }
```

| Table | Purpose |
|---|---|
| `profiles` | One row per account (created on first sign-in). |
| `friendships` | Friend requests, accepted friends, blocks. |
| `groups`, `group_members` | Reusable groups for repeat Picks. |
| `picks` | One decision session: host, category, center + radius, deadline, close threshold, state, and the stored winner (`winner_place_id`, `decided_at`, `decided_by`). |
| `pick_participants` | Who is in a Pick and whether they finished swiping. |
| `pick_join_codes` | 6-character join codes / QR / `wtw://join/CODE` links. |
| `places`, `place_cache` | Normalized provider places; cached provider data (30-day TTL, subject to Google's terms). |
| `pick_candidates` | The fixed, shared pool for one Pick (snapshot, so history does not change when a place does). |
| `preferences` | Each participant's private Yes/Maybe/No per candidate. |
| `ranking_results` | Output of the ranking engine for a Pick. |
| `final_votes` | One ballot per participant among the finalists. |
| `notifications`, `push_tokens` | Invitation and Pick-status notifications. |
| `saved_places` | Ideas saved from Discover. |

## Pick state machine (Alan)

Code: `supabase/functions/_shared/domain/pickState.ts` (`canTransition(from, to, actor)`; `dueToClose` for the deadline / close-threshold rule).
The API is the only writer of `picks.state` and rejects every action that does not belong to the current state
(for example a swipe after ranking, or a vote for a non-finalist).

```mermaid
stateDiagram-v2
    [*] --> draft : host creates Pick
    draft --> swiping : host starts
    swiping --> ranking : host closes / system at deadline or close threshold
    ranking --> completed : system, clear winner
    ranking --> final_vote : system, no clear winner
    final_vote --> completed : system, all voted or deadline
    draft --> canceled : host / system
    swiping --> canceled : host / system
    ranking --> canceled : host / system
    final_vote --> canceled : host / system
    completed --> [*]
    canceled --> [*]
```

| From → To | Host | Participant | System |
|---|---|---|---|
| draft → swiping | ✅ | ❌ | ❌ |
| swiping → ranking | ✅ (close manually) | ❌ | ✅ (deadline, or X% finished) |
| ranking → completed | ❌ | ❌ | ✅ (clear winner) |
| ranking → final_vote | ❌ | ❌ | ✅ (no clear winner) |
| final_vote → completed | ❌ | ❌ | ✅ (all voted, or deadline) |
| any unfinished → canceled | ✅ | ❌ | ✅ (e.g. stale Pick sweep) |
| completed / canceled → anything | ❌ | ❌ | ❌ |

"System" means our API acting on its own authority: the `pg_cron` deadline sweep, the close-threshold check after a swipe, and the ranking step itself.
Participants never change the state; they only swipe and vote. Refreshing the candidate pool stays in `swiping` (after swiping has started it asks for confirmation and resets everyone's answers).

## Scoring (Alan)

Code: `supabase/functions/_shared/domain/ranking.ts` (`scoreCandidate`, `rankCandidates`, `clearWinner`); tests in `tests/domain/ranking.test.ts`.
This is a transparent formula, not an AI prediction.

**Per candidate**, with `n` participants and answers Yes = 1, Maybe = 0.5, No = 0, **missing = 0.5 (counts as Maybe)**:

| Term | Definition |
|---|---|
| preference | mean of all `n` values |
| consensus | 1 − (population std-dev of the `n` values ÷ 0.5) |
| coverage | people who actually answered ÷ `n` |
| noProportion | number of No answers ÷ `n` |

```
score = 100 × (0.70·preference + 0.20·consensus + 0.10·coverage) − 15·noProportion,   clamped to 0–100
```

**Worked example: broad enthusiasm with one objection vs. lukewarm agreement**

| Answers (n = 4) | preference | consensus | coverage | noProportion | score |
|---|---|---|---|---|---|
| Yes, Yes, Yes, No | 0.75 | 0.134 | 1 | 0.25 | **61.4** |
| Maybe × 4 | 0.50 | 1.000 | 1 | 0 | **65.0** |

Complete moderate agreement edges out a divisive option: one strong "No" costs both consensus and the −15 penalty.
Other reference points (all locked by tests): all Yes = 100, all No = 15, nobody answered = 55, 3 Maybe + 1 missing = 62.5.

**Ordering ties:** score (desc) → distance from the Pick center (asc, haversine) → place id (asc). The result is deterministic.

**Clear winner:** if only one candidate exists, or #1 beats #2 by **≥ 10 points**, #1 wins and the final vote is skipped.
Otherwise the group votes among the top 3 (or the 1–2 that exist). If #1 is tied, it is never a clear winner; everyone tied for #1 is a finalist, even if that makes more than 3.
Float noise is ignored (differences under 1e-9 count as equal), so an exact 10-point gap always counts.

**Final-vote tie-break:** most votes → higher score → closer to the center → place id (`voteWinner`; no ballots by the deadline means #1 wins).

**What users see:** rank only (1st / 2nd / 3rd, or "Clear winner!"). Scores are stored in `ranking_results.score` for tests and debugging and are never sent to the app.

**Input mapping:** `preferences.value` is 0 = No, 1 = Maybe, 2 = Yes; `answerFromDb` converts it before scoring.

**Open question for the team:** the weights (0.70 / 0.20 / 0.10, −15) are a starting hypothesis. M5 user sessions should tell us whether one "No" is penalized enough.

## What changed since M1 (Mike)

| Topic | In M1 | Decision now |
|---|---|---|
| Platform | The proposal said web app; the M1 slides said native apps. | **Native, via Expo + React Native** (one TypeScript codebase for iOS and Android). |
| Group location | A "fair radius for the group" computed from everyone's location. | **The host picks the center and radius** when creating the Pick (`picks.center_lat`, `center_lng`, `radius_m`). |
| Guests | Guests could take part. | **An account is required** to join a Pick. |
| Score | Users see a WTW Match Score. | **Users see rank only** (1st / 2nd / 3rd, or "Clear winner!"). Scores stay server-side; see [Scoring](#scoring-alan). |

## Updated for M3: what changed (Mike)

- **The whole loop has screens**: Create → Lobby (code + QR + Share) → Swipe → Waiting → Results → Vote → Winner, plus a canceled / offline / not-found view. Every screen follows the Pick's state by itself (see [UI flow](#ui-flow-mike)).
- **Live progress without leaking answers**: the app subscribes to Supabase Realtime on `picks` and `pick_participants` only. `pick_participants.finished_at` is kept current by a trigger (`0005_live_progress.sql`), so the socket carries "who's done", never answers. If the channel fails, the app polls `GET /picks/:id/progress` every 5 s. `preferences`, `final_votes` and `ranking_results` are **not** in the publication.
- **Per-person deck**: Swipe reads `GET /picks/:id` (Alan), which returns the candidates in my own shuffled order plus my answers, instead of reading `pick_candidates` in place-id order.
- **Rank stays rank-only**: Results shows 1st / 2nd / 3rd and "Clear winner!"; the vote shows finalists by rank; the API and reads never carry scores.
- **Look**: the live-demo styling (dark, flame gradient, Poppins, Tinder-style deck, confetti reveal) is now the app's look; shared pieces live in `src/components` (`PickParts`, `ResultCards`, `HostMenu`).
- **Mock mode plays the whole loop**: Ava, Ben and Cam join, swipe and vote on timers, using the shared ranking and vote rules, so the demo runs without a network (`EXPO_PUBLIC_USE_MOCK=1`).

## UI flow (Mike)

Every Pick screen calls `usePickLive` (state + progress) and `usePickRoute` (which screen belongs to the state). Opening a Pick from anywhere goes to `/pick/[id]`, which forwards to the current step, so a late arrival lands in the right place.

```mermaid
flowchart LR
  SignIn[Sign in] --> Picks
  Picks -->|+| Create[Create Pick]
  Create --> Lobby
  Picks --> Entry["/pick/[id]"]
  Entry -->|draft| Lobby
  Entry -->|swiping| Swipe
  Entry -->|final_vote| Vote
  Entry -->|completed| Winner
  Entry -->|canceled| Canceled
  Lobby -->|host starts| Swipe
  Swipe -->|all answered| Waiting
  Waiting -->|change answers| Swipe
  Waiting -->|closed: host, threshold or deadline| Results
  Swipe -->|closed while swiping| Results
  Results -->|clear winner| Winner
  Results -->|too close| Vote
  Vote -->|everyone voted, host or deadline| Winner
```

| Pick state | Screen(s) | What it shows |
|---|---|---|
| `draft` | Lobby | Who's in (live), join code + QR + Share, settings (radius, pool, deadline, close rule). Host: Start (needs 2 people), Cancel. |
| `swiping` | Swipe, then Waiting | Swipe: my shuffled deck, resume at first unanswered, Back to change, details sheet, "X of N friends done", deadline countdown; host menu (Close now, Get new places with a reset warning, Cancel). Waiting: "3 of 5 finished swiping", avatars with checks (never answers), countdown, host Close now / Cancel, Change my answers. |
| `ranking` | Results | "Counting everyone's swipes…" |
| `final_vote` | Results → Vote | Results: "Too close to call", finalists by rank. Vote: tap a finalist (radio group), change until it closes, "2 of 4 voted"; host Close the vote. Late arrivals go straight to Vote. |
| `completed` | Results → Winner | Results: "Clear winner!" or "Decided!", 1st/2nd/3rd (rank only). Winner: the place, how it was decided (clear winner / vote / tie-break), Directions (Apple Maps on iOS, Google Maps elsewhere), "Saved to your history". |
| `canceled` | `/pick/[id]` | "This Pick was canceled", Start a new Pick. |
| any, offline | same screen | Last good data stays, a banner says we're retrying (polling every 5 s), Try again. Before anything loaded: "You're offline" with Try again. |

**Accessibility.** Every tappable is ≥ 44 pt (`MIN_TARGET`). Yes / Maybe / No buttons are labelled with the place ("Yes to Kung Fu Tea"); the vote list is a radio group whose items say rank, name and "your vote"; progress counts are a polite live region; avatars announce "Ava, done". Text follows the system font scale (no fixed-height text boxes), long names wrap to two lines instead of being cut, and inputs on Create Pick stay above the keyboard (`KeyboardAvoidingView` in `Screen`).

Screens (mock mode, 375 × 812 viewport):

| Picks | Lobby | Swipe | Waiting |
|---|---|---|---|
| ![Picks](img/m3-picks.jpg) | ![Lobby](img/m3-lobby.jpg) | ![Swipe](img/m3-swipe.jpg) | ![Waiting](img/m3-waiting.jpg) |

| Results | Vote | Winner |
|---|---|---|
| ![Results](img/m3-results.jpg) | ![Vote](img/m3-vote.jpg) | ![Winner](img/m3-winner.jpg) |

## Requirement → component map (Mike)

Status as of M3 (Oct 21). "Screen done" means the app side is built and runs end to end in mock mode; the matching API route's PR is listed where it isn't merged yet.

| FR | Requirement | Screen | API route | Table(s) | Owner | Status |
|---|---|---|---|---|---|---|
| FR-01 | Create an account, sign in, sign out, and maintain a profile. | Sign in; Profile tab (sign out) | None (Supabase Auth) | `profiles` | Razin (auth), Mike (screens) | Sign-in done; profile editing: Razin |
| FR-02 | Complete and later edit a short preference profile. | planned | planned | `profiles` | Razin | M4 |
| FR-03 | Send, accept, remove, and block friend relationships. | Friends tab (placeholder) | planned | `friendships` | Razin | M4 |
| FR-04 | Create, name, and manage a reusable group. | planned | planned | `groups`, `group_members` | Razin | M4 |
| FR-05 | Create a Pick for selected friends or a saved group. | Create Pick → Lobby | `POST /picks` (PR #12) | `picks`, `pick_participants` | Alan, Mike (screens) | **Done** by join code; friends/groups M4 |
| FR-06 | Select Food or Activities and optionally refine location, radius, price, and open status. | Create Pick (map pin, search, radius, pool, deadline, close rule) | `POST /picks` | `picks` | Josh, Mike (screen) | **Done**; price/open filters M4 |
| FR-07 | Retrieve and normalize a bounded nearby candidate pool. | Lobby Start; host "Get new places" | `POST /picks/:id/start`, `/refresh` (PR #12) | `places`, `place_cache`, `pick_candidates` | Josh, Alan | API in review |
| FR-08 | Join an authorized Pick through the app or invitation link. | Lobby shows code + QR + Share (`wtw://join/CODE`) | `POST /join` (Razin) | `pick_join_codes`, `pick_participants` | Razin, Mike (lobby) | Lobby done; join screen and route: Razin |
| FR-09 | Record exactly one Yes, Maybe, or No response per candidate and revise it before closure. | Swipe (buttons, gesture, Back, Change my answers) | `POST /picks/:id/swipes` | `preferences` | Alan, Mike (screen) | **Done** |
| FR-10 | Persist responses and restore progress after refresh or reconnection. | Swipe resumes at my first unanswered card, in my order | `GET /picks/:id` (PR #12) | `preferences` | Mike | **Done** |
| FR-11 | Hide individual responses until aggregation is complete. | Waiting and Vote show counts and checks only | `GET /picks/:id/progress` (counts only); Realtime on `picks`, `pick_participants` only | `pick_participants.finished_at` | Mike, Razin (RLS) | **Done** |
| FR-12 | Close responses after all participants finish or according to a documented timeout rule. | Waiting (countdown, host Close now); everyone moves to Results by themselves | `POST /picks/:id/close` (PR #13); deadline sweep (Josh) | `picks` | Alan, Josh | Screens done; API in review |
| FR-13 | Calculate deterministic group scores and return the top three candidates. | Results (rank only) | close → `ranking_results` | `ranking_results` | Alan | **Done** |
| FR-14 | Provide a plain-language explanation for each top result (rank + reason, no number). | planned | planned | `ranking_results` | Alan | M4 |
| FR-15 | Vote once among the three finalists. | Vote (changeable until close; host Close the vote) | `POST /picks/:id/vote`, `/close-vote` (PR #13) | `final_votes` | Mike (screen), Alan | Screen done; API in review |
| FR-16 | Resolve ties, declare one winner, and save the outcome. | Winner (clear winner / vote / tie-break; Directions; saved) | vote tally (PR #13) | `picks`, `final_votes` | Alan | Screen done; API in review |
| FR-17 | Browse a bounded individual Discover feed and save interests. | Discover tab (placeholder) | planned | `places`, `saved_places` | Josh | M4 |
| FR-18 | View completed Pick history for groups they belong to. | Picks tab "History" (decided + canceled) | RLS read of my Picks | `picks` | Razin, Mike | **Done** for my Picks; groups M4 |

## Architecture (Josh)

```mermaid
flowchart TD
    App[Expo React Native App] --> Auth[Supabase Auth]
    App -->|reads through RLS| DB[(Supabase Postgres + RLS)]
    App -->|Bearer token| API[Hono Edge Function api]
    API -->|service-role atomic writes via RPCs| DB
    API --> Domain[Pure TypeScript ranking and state logic]
    API -.->|discovery integration planned| Provider[PlaceProvider]
    Provider --> Mock[MockProvider - placeholder JSON now]
    Provider -.-> Google[Google Places - planned]
    DB -.-> Realtime[Supabase Realtime - planned subscriptions]
    Realtime -.-> App
    Cron[pg_cron - planned] -.->|separate server authentication required| API
```

Implemented: starter app, ranking/state/geometry, Hono heartbeat handlers, Razin's
shared getUser, server client, error envelope, schema/RLS, the transactional heartbeat
RPCs, the seeded demo Pick, mock provider and CI configuration. Mock places are explicitly
unapproved placeholders. The provider is independently usable; candidate discovery is
not yet a heartbeat route. Realtime subscriptions, Google Places, caching/rate limits
and cron scheduling are planned. Cron must use a separate authenticated server entry point; it must not
impersonate a user or bypass host authorization on the heartbeat routes.

All application writes go through `api`; mobile reads use RLS. Ranking reuses Alan's
functions, stores scores server-side, and returns only ordered place IDs/ranks and
a winner/finalist decision. Persistence and state transitions require the atomic
operations in [api-integration.md](api-integration.md), owned jointly with Razin.

## Stack + why (Josh)

| Technology | Why |
|---|---|
| Expo / React Native | One mobile codebase supports iOS and Android with quick device iteration. |
| TypeScript | Shared types connect the app, API and pure decision engine. |
| Supabase Auth | Managed identity verifies users without a custom password system. |
| Supabase Postgres + RLS | Relational constraints and row policies protect shared Pick data. |
| Supabase Realtime | Planned subscriptions keep group progress synchronized. |
| Supabase Edge Functions | A server runtime keeps credentials and privileged operations off phones. |
| Hono | A small router gives the single API explicit routes and error handling. |
| Our TypeScript API | One write boundary enforces authorization, state and ranking rules. |
| PlaceProvider / Google Places abstraction | Stable normalized candidates let mock data become live discovery later. |
| Jest | Repeatable tests exercise shared logic without a phone or database. |
| GitHub Actions | Every PR checks code, tests and Android bundling before review. |
## Security & privacy (Razin)

Code: `supabase/migrations/0001_init.sql`, `0002_heartbeat_rpcs.sql`; tests in `supabase/tests/rls_test.sql` (`supabase db reset && supabase test db`).

**One writer.** Only the `api` Edge Function writes to Postgres, using the service role on the server. The app gets **no** INSERT / UPDATE / DELETE: no table grants and no write policies. Even a bug in the app, or a user with a modified client, cannot change a Pick, a swipe or a result directly.

**Reads are filtered by RLS on every table.** The app reads as `authenticated` (never `anon`):

| Table | A signed-in user can SELECT |
|---|---|
| `picks`, `pick_participants`, `pick_candidates`, `ranking_results` | rows of Picks they participate in |
| `preferences` | **only their own** answers (nobody sees how others swiped) |
| `profiles` | their own, and people they share a Pick with |
| `places` | places that are candidates in one of their Picks |

Membership checks use `private.*` helpers (security definer, empty `search_path`) in a schema the Data API does not expose.

**Explicit grants.** The hosted project does not auto-expose new tables, and the migration does not rely on defaults either: it revokes everything from `anon` and `authenticated`, then grants `SELECT` to `authenticated` table by table and `ALL` to `service_role`. New tables must add their own RLS policy **and** grant, or the app cannot see them.

**Scores stay on the server.** `ranking_results.score` has no client grant (column-level `SELECT` on `pick_id, place_id, rank, finalist, created_at` only). `select=*` from the app fails with `permission denied`, so a careless query errors instead of leaking. The API also never returns scores. `ranking_results` is intentionally **not** in the Realtime publication, because Realtime would ship whole rows.

**Server-only RPCs.** `heartbeat_*` functions are executable only by `service_role`; they re-check membership, host, state and version inside one locked transaction, so forged user ids or stale requests are rejected (PT403 / PT409).

**Authentication.** Email one-time code (6 digits, 1-hour expiry); no passwords are stored. The API verifies every mutation with `getUser(req)` (`supabase/functions/_shared/auth/getUser.ts`), which asks Supabase Auth to validate the token rather than decoding it, so signed-out or deleted users are rejected. A `profiles` row is created automatically on first sign-in.

**Data we keep.** `profiles` holds a display name and avatar URL only; email lives in Supabase Auth and is never exposed to other users. Preferences are private to their author. Place data is a snapshot per Pick so history does not change later.

**Secrets.** No keys or passwords are committed. The service-role key exists only as an Edge Function secret; the app ships only the public anon/publishable key, which is useless without a user session because `anon` has no table grants.

**Not covered yet:** rate limiting on the API, account deletion flow, join-code brute force protection (M3 with `pick_join_codes`).

## API list v0 (Razin)

Base URL: `<SUPABASE_URL>/functions/v1/api`. Every route except `/health` needs `Authorization: Bearer <user access token>`. Errors are `{ "error": { "code", "message" } }` with 400 / 401 / 403 / 404 / 409 / 500 / 503. Details of the implemented routes: `docs/api-integration.md` (Josh).

**Writes (through the API only)**

| Method & path | Who | What | Status |
|---|---|---|---|
| `GET /health` | anyone | liveness | implemented |
| `POST /picks/:id/swipes` | participant, Pick `swiping` | `{ placeId, value: 0\|1\|2 }` upserts my answer | implemented |
| `POST /picks/:id/rank` | host, Pick `swiping` | close swiping, rank, store results; returns top 3 + decision (no scores) | implemented |
| `POST /picks` | signed-in user | create a Pick (category, center, radius, deadline, close threshold) | planned |
| `POST /picks/:id/candidates` | host, `draft` | fetch and freeze the candidate pool | planned |
| `POST /picks/:id/start` | host, `draft` | `draft → swiping` | planned |
| `POST /picks/join` | signed-in user | join by 6-character code | planned |
| `POST /picks/:id/finish` | participant | mark my swiping finished (drives close threshold) | planned |
| `POST /picks/:id/votes` | participant, `final_vote` | `{ placeId }` for a finalist | planned |
| `POST /picks/:id/cancel` | host | any unfinished state → `canceled` | planned |
| `PATCH /me` | signed-in user | update display name / avatar | planned |

**Database RPCs used by the API** (service role only, `0002_heartbeat_rpcs.sql`)

| Function | Returns / effect |
|---|---|
| `heartbeat_load_pick(p_pick_id, p_user_id)` | `PickSnapshot` json (id, hostId, state, center, participantIds, candidates, preferences, version) or null |
| `heartbeat_upsert_swipe(p_pick_id, p_user_id, p_place_id, p_value)` | upserts one preference, advances version |
| `heartbeat_save_ranking(p_pick_id, p_user_id, p_version, p_ranking)` | `swiping → ranking → completed \| final_vote`, replaces `ranking_results`, sets winner metadata |

**Reads (app → Supabase directly, filtered by RLS)**

| Query | Used for |
|---|---|
| `pick_participants?select=picks(id,state,category,deadline_at)&user_id=eq.<me>` | my Picks |
| `pick_candidates?select=place_id,snapshot&pick_id=eq.<id>` | swipe cards |
| `preferences?select=place_id,value&pick_id=eq.<id>&user_id=eq.<me>` | resume swiping |
| `ranking_results?select=place_id,rank,finalist&pick_id=eq.<id>` | results (never `score`) |
| `picks?select=state,host_id,winner_place_id,decided_by&id=eq.<id>` | outcome / host check |
