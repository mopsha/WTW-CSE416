@AGENTS.md

# WTW contributor guide

WTW (What's the Word?) helps people choose nearby food or activities by swiping
No/Maybe/Yes and ranking shared candidates. Week 1 targets sign-in → seeded Pick →
swipe → Rank → top three. See README.md for current integration blockers.

Stack: Expo SDK 57, React Native, TypeScript, Expo Router, Supabase Auth/Postgres/RLS,
Realtime (planned), one Hono TypeScript Edge Function `api`, Jest and GitHub Actions.

## Layout

- `app/`: Expo Router screens and layouts; reusable UI/hooks/lib live under `src/`.
- `supabase/functions/api/`: Deno HTTP/auth/service-role database adapters.
- `supabase/functions/_shared/domain/`: pure TypeScript ranking, state, and geometry.
- `supabase/functions/_shared/api/`: pure heartbeat orchestration and errors.
- `supabase/functions/_shared/places/`: provider types and mock implementation.
- `supabase/seed/places.json`: explicitly placeholder provider data, not a SQL seed.
- `tests/`: Jest tests; Edge HTTP tests live in `api/app_test.ts` and run in Deno.
- `docs/design.md`: owned design sections; `docs/api-integration.md`: implemented DB contract.
- `.github/workflows/ci.yml`: validation; `M1/`: proposal/slides.

## Architecture and development rules

- The API is the only application database writer, using a server-only service-role client.
- Clients read through RLS; service credentials never enter Expo public variables or bundles.
- Authenticate callers; derive user IDs from their verified tokens. Atomic writes must
  recheck authorization and state, since service role bypasses RLS.
- `_shared/domain` stays pure TypeScript. No React Native or Deno-specific imports in
  shared backend/domain code. Use explicit `.ts` imports where required by Deno.
- Reuse Alan's ranking/state functions, Razin's schema/auth helper, Mike's client.
- One database migration per PR, branch per task, and PR review before merge.
  Do not create a branch or commit on someone's behalf without authorization.
- Read AGENTS.md and version-matching Expo docs before changing Expo/React Native APIs.
- Use `npx expo install <package>` for app dependencies. Backend imports are pinned in deno.json.
- Run lint/typecheck/tests and Android export; test Deno independently of app tsc.

## Commands

From the root: `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`,
`npx expo start`, `npx expo export --platform android`.

Backend: `deno check --config supabase/functions/api/deno.json supabase/functions/api/index.ts`
and `deno test --config supabase/functions/api/deno.json supabase/functions/api/app_test.ts`.

With Supabase CLI + Docker and project configuration: `supabase start`,
`supabase functions serve api` (config.toml sets `verify_jwt = false` for api). `supabase db reset` resets the local
DB and applies committed migrations and the demo seed. See README
for setup prerequisites and which steps are blocked. Supabase commands are verified
against the official CLI reference, not claimed to have run locally.
