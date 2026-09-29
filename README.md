# WTW — "What's the Word?"

**Stop debating. Start deciding.**

CSE 416-03 · Software Engineering · Fall 2026
Team: Mike · Josh · Alan · Razin

## About

WTW is a social decision-making app for friends who want to decide where to eat or what to do — without the endless group-chat debate. It turns a vague "what do you want to do?" conversation into a short, structured workflow: create a group Pick, privately rate a shared pool of nearby options, see an explainable group ranking, and land on one plan everyone's actually down for.

## The Problem

Group plans stall even when everyone wants to meet up. No one wants to suggest first because it might get shot down, preferences stay scattered and get revealed one at a time, and the option space is too big for a group to reason through in a chat thread. Discovery apps like Google Maps and Yelp are great at finding places — they just don't help a *group* agree on one.

| Alternative | Strength | Gap WTW addresses |
|---|---|---|
| Group chat | Everyone already has it | Sequential suggestions, no mechanism forces convergence |
| Google Maps / Yelp | Great search, reviews, directions | Built for individual discovery, not group agreement |
| General polls | Fast once options are known | Someone still has to research and enter the options |
| One person decides | Fast if the group accepts it | Doesn't reflect the group, often defaults to familiar spots |

## Who It's For

- College students and young adults making casual, spontaneous plans
- Small groups, typically 2–8 people
- Real situations: friends picking a restaurant, roommates planning a night out, a group deciding on an activity
- **Initial focus:** Stony Brook University and friends — direct recruiting, in-person usability testing, and real feedback loops within the semester

## How It Works

**User flow:** Open a session → browse the same shared options together → swipe Yes / Maybe / No → responses stay private → see the winner.

**Behind the scenes:** Collect everyone's answers → score with one fair, consistent rule → rank highest matches first → reveal the winner plus runner-ups.

```
Nearby options → 20–30 curated candidates → Top three finalists → One final plan
```

Goal: under 30 seconds to start swiping, about 5 minutes to reach a group decision.

## Version 1 Scope

**In scope**
- Account creation, sign-in, profiles, and a short preference survey
- Friend relationships, reusable groups, and invitation links
- Create a Pick, invite participants, and track live status
- Restaurant results from one external place provider, filtered by location/distance, behind a provider adapter (mockable)
- Private Yes / Maybe / No responses per candidate
- Explainable scoring with a documented tie-break rule
- Top-three ranking, final vote, and one stored winner
- Responsive mobile-first layouts, input validation, row-level security, rate limits, and automated tests

**Outside v1 (deferred until the core decision loop is solid)**
- Native iOS/Swift and Android/Kotlin apps
- Reservations, ticket purchasing, payments, ride-sharing, and calendar integrations
- Machine-learning personalization, weather-aware or midpoint suggestions
- Group chat, public feeds, full reviews platform, and dating-style features
- Automatic background tracking of every location a user visits

## Why This Needs a Semester

This isn't a UI problem — it's a handful of interacting engineering problems that only show up once you actually build the system:

1. **Fair group location** — participants aren't in the same place, so "nearby" has to be calculated per person and reconciled for the whole group, not just one phone's GPS.
2. **Concurrent live sessions** — every Pick is its own tracked session (who's joined, what's been swiped, when it expires), and many can run at once without leaking into each other.
3. **Fresh candidate data** — place data comes from an external source and goes stale (hours change, spots close). Caching for speed means deciding how often to re-scrape so the app never sends a group somewhere that's already closed.
4. **Multi-user correctness under load** — location math feeds candidate selection, swipe state feeds the next session, and none of it works in isolation. The real bugs live in how these pieces interact under concurrent use, which only surfaces once it's built, run, and stress-tested.

## Architecture & Stack

| Layer | Choice |
|---|---|
| App | Expo + React Native (mobile-first, one shared codebase for iOS/Android) |
| Language | TypeScript |
| Data | PostgreSQL + Realtime |
| Identity | Supabase Auth + Row-Level Security |
| Server boundary | Supabase Edge Functions |
| Place data | External place-data API behind a provider adapter (mockable) |
| Testing | Jest + Maestro |
| Delivery | EAS Build + GitHub Actions |

```
Mobile App (Expo + React Native)
        ↓
Server Boundary (Supabase Edge Functions)
        ↓
Auth + RLS   |   Postgres + Realtime   |   Place Provider Adapter
                                                ↓
                                      External place-data API
```

Postgres is the source of truth; Realtime carries live Pick updates; Edge Functions protect provider credentials and enforce rate limits.

## Team & Ownership

| Owner | Area | Focus |
|---|---|---|
| **Alan** | Decision Engine & Data Model | Pick state, private responses, ranking logic, tie-breaking, result persistence |
| **Razin** | Accounts, Groups & Security | Authentication, profiles, invitations, authorization, row-level security |
| **Josh** | Place Provider & Server Services | Provider adapter, Edge Functions, normalization, caching, rate limits, mocks |
| **Mike** | Mobile UX & Live Coordination | Expo navigation, onboarding, swiping, live progress, voting, accessibility, device testing |

All four members share responsibility for requirements decisions, architecture and code review, integration testing, user testing, deployment, and AI-use documentation.

## Scoring Model (v1)

Each response maps to a utility value: **Yes = 1.0, Maybe = 0.5, No = 0.0**.

```
WTW Score = 100 × (0.70 × preference + 0.20 × consensus + 0.10 × coverage) − 15 × no-vote proportion
```

Displayed to users as a **WTW Match Score** — an explainable, transparent scoring model, not an AI prediction. Weights are a starting hypothesis to be validated with unit tests and user feedback.

## Local development (Week 1)

Current checkout includes Alan's ranking/state/geometry logic, Josh's API and mock
provider, and Razin's shared auth, Supabase configuration, schema/RLS, transactional
RPCs and SQL seed, and Mike's app: email-code sign-in, Home, Swipe and Results screens
with the API client (plus a no-backend mock mode). The database/API contract is in
[docs/api-integration.md](docs/api-integration.md). Local database and authenticated
HTTP checks are required before claiming the complete heartbeat works.

### 1. Prerequisites and install

Use Node 22.13+ (22 LTS), npm, Git, and Expo Go or a compatible development build.
For backend integration install the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started)
and Docker with its daemon running. Deno 2 is needed for standalone Edge checks.

```sh
git clone https://github.com/mopsha/WTW-CSE416.git
cd WTW-CSE416
npm ci
cp .env.example .env.local
```

### 2. Environment variables

Public/mobile variables in `.env.local` (safe to bundle):

| Variable | Value |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | Local or hosted Supabase API URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Matching project's public anon key |

Backend runtime only:

| Variable | Value |
|---|---|
| `SUPABASE_URL` | Internal/backend Supabase URL |
| `SUPABASE_ANON_KEY` | Public key used by the backend shared Auth verifier |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret service-role key used only in Edge Functions |

The Supabase local/hosted Edge runtime supplies these backend variables. For a
standalone runtime, configure them in its environment, never in `.env.local`,
`app.json`, an `EXPO_PUBLIC_*` variable, or source control. No real secrets belong
in this README.

**No backend yet?** Set `EXPO_PUBLIC_USE_MOCK=1` in `.env.local` to run every screen
against a local 20-place fixture (sign-in code `123456`). Leave it unset (or `0`) for the
real backend.

### 3. Start Supabase and prepare data

Docker Desktop must be running. `supabase start` applies the migrations and the demo seed
(first run downloads the images and takes a few minutes):

```sh
supabase start
supabase status
```

Use status output locally to configure the public URL/anon key; do not share secret
keys from that output. To reset to a fresh seeded state at any time:

```sh
supabase db reset
```

The seed creates one demo Pick in `swiping` (id `de000000-0000-4000-8000-000000000001`)
with 20 real Stony Brook-area food places (stock photos for now) and 3 bot participants who already answered.
Sign in once in the app (email code; locally the email arrives in Mailpit at
http://127.0.0.1:54324), then join the demo Pick **as host** so you can tap Rank.
In Studio's SQL editor (http://127.0.0.1:54323) or `psql`:

```sql
select private.seed_add_participant(
  (select id from auth.users where email = 'you@example.com'), true);
```

Without `true` you join as a participant: swiping works, Rank returns 403 (host only).

### 4. Serve the API (separate terminal)

```sh
supabase functions serve api
curl http://127.0.0.1:54321/functions/v1/api/health
```

Health returns `{"status":"ok"}` without touching the database. `config.toml` sets
`verify_jwt = false` for `api` so the function verifies JWTs itself and keeps health public; POST routes always
verify the Bearer access token with Auth. Align hosted function configuration with
[the API integration contract](docs/api-integration.md) before deployment.

With the local stack running, use a signed-in user's access token:

```sh
curl -X POST "$EXPO_PUBLIC_SUPABASE_URL/functions/v1/api/picks/$PICK_ID/swipes" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"placeId":"seed-place-01","value":2}'
curl -X POST "$EXPO_PUBLIC_SUPABASE_URL/functions/v1/api/picks/$PICK_ID/rank" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

Set shell variables explicitly for these examples (`.env.local` is loaded by Expo,
not automatically by your shell). Use a candidate actually seeded in that Pick.
Ranking is host-only per Alan's state machine. Responses expose ranks, never scores.

### 5. Start Expo (separate terminal)

```sh
npx expo start
```

Scan the QR on your phone. A phone cannot reach your computer using `127.0.0.1`:
set the **mobile** Supabase URL to your computer's reachable LAN address and allow
local traffic through your firewall. Keep backend runtime URLs as supplied by Supabase.
Restart Expo after changing public variables. Sign in with the emailed code, open the
demo Pick from Home, swipe all 20 cards, then tap Rank (host) to see the top three.

### 6. Validate

```sh
npm run lint
npm run typecheck
npm test -- --runInBand
npx expo export --platform android
deno check --frozen --config supabase/functions/api/deno.json supabase/functions/api/index.ts
deno test --frozen --config supabase/functions/api/deno.json supabase/functions/api/app_test.ts
supabase db reset
supabase test db
```

`npm test` is the existing Jest script; `--runInBand` limits worker usage. Android
export validates bundling; it does not build/install a native APK. CI runs install,
lint, typecheck, Jest, export and Deno checks on every PR and push to main.
Supabase setup commands above were checked against the [CLI reference](https://supabase.com/docs/reference/cli/introduction);
Expo commands follow the [Expo CLI reference](https://docs.expo.dev/more/expo-cli/).

## Repo structure

```text
app/                             Expo Router screens
src/{components,hooks,lib}/       UI components, auth hook, Supabase/API clients, mock mode
supabase/functions/api/           Hono Edge Function and server adapters
supabase/functions/_shared/       Pure domain, heartbeat, provider modules
supabase/seed/places.json         Placeholder places for MockProvider
tests/                           Jest tests
docs/                            Design and integration contract
.github/workflows/ci.yml          Validation pipeline
M1/                              Proposal and slides
```
