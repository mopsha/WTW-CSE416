# Requirements status (M4)

State of `integ/m4` (PR #35) on Nov 1, 2026: **12 done, 10 partial, 0 cut**. This is a draft; owners should correct their rows.

**Read this first**

- **Most M4 work isn't on `main` yet.** Of M4's work, only the display name and EAS config have merged. The rest lands when #35 merges.
- **Apart from the sign-in email, nothing here has run on wtw-dev or on a phone.** Evidence is CI (migrations, database tests, API tests, Jest), reading the code, and clicking through mock mode in a browser. The installed test builds predate most of it.
- **Done** means the requirement is built and works in those checks; known bugs are listed. **Partial** means part of the requirement is missing or doesn't work. **Cut** means the team decided not to ship it for M4, with a reason.

## Functional requirements

| FR | Requirement | Status | What's there | What's missing | Owner |
|---|---|---|---|---|---|
| FR-01 | Account, sign in, sign out, profile | Done | Emailed 6-digit codes on wtw-dev through custom SMTP, name step, profile editing, sign out, account deletion. A new-user sign-up worked on a phone on Nov 1; the email for an existing account isn't tested yet | | Mike |
| FR-02 | Preference survey, editable later | Done | Onboarding survey, edit from Profile, private to the API | | Mike |
| FR-03 | Send, accept, remove, block friends | Partial | Add by email, accept, decline, unfriend, block API | Block is only in the Lobby and Waiting room, not on the Friends tab or requests. A sender can't see or cancel a pending request (by design, 0018) | Razin, Mike |
| FR-04 | Create, name, manage a group | Done | Create, rename, delete, add and remove members, leave. Pick again uses current group membership (0020) | | Razin |
| FR-05 | Pick for selected friends or a saved group | Partial | Group Picks from the Picks tab and group screen | Choosing individual friends: `POST /picks/:id/invite` exists but no screen calls it | Razin |
| FR-06 | Category, location, radius, price, open status | Partial | Food, Activities, Custom, map pin, radius, price filter | Unknown fixture hours/prices correctly cannot satisfy explicit Open now/Free filters; no verified free/open fixture data. Drafts cannot be edited | Josh |
| FR-07 | Bounded nearby candidate pool | Partial | Pool building, cap and rate limits; Discover can use Google | Picks always use the 36 mock places around Stony Brook, so real places are Discover-only, and wtw-dev's provider setting is unconfirmed. Discover now has a separate 20/user/day limit (0021); live Google Pick snapshots still require an approved retention design | Josh |
| FR-08 | Join through the app or an invite link | Partial | Join codes, `wtw://` links, brute-force limit, lobby lock | No web page or Universal Links, no revoke in the app, and `wtw://` tapped from iMessage is untested | Razin |
| FR-09 | One answer per candidate, changeable | Done | Swipes, buttons, Back, Change my answers | | Alan, Mike |
| FR-10 | Answers persist and progress restores | Done | Server-saved answers, resume after reload | | Alan |
| FR-11 | Answers hidden until aggregation | Done | Counts only during swiping. After close, FR-14 reasons describe the group's answers, only in groups of 4 or more | | Mike, Razin |
| FR-12 | Close when everyone finishes or on timeout | Done | Host close, threshold auto-close, deadline sweep | | Alan, Josh |
| FR-13 | Deterministic scores, top three | Done | Shared ranking code with tests | | Alan |
| FR-14 | Plain-language reason, no numbers | Done | `explainRank`, shown on Results | | Alan |
| FR-15 | Vote among the three finalists | Done | Changeable vote, host close, deadline | | Alan, Mike |
| FR-16 | Tie-break, one winner, saved | Done | Tally, tie-break by rank, Winner screen | | Alan |
| FR-17 | Discover feed and saved interests | Partial | `GET /discover` scored by survey answers, filters, save/unsave/list; includeSaved is category/radius/filter-aware and deduplicated | No screen lists saved places, no "That's today's 20" end state, and saved Google IDs cannot yet be hydrated into persistable Pick snapshots | Josh, Mike |
| FR-18 | Completed Pick history | Partial | My history with winner, finalists and who went; Pick again | Group history is linked; Pick again preserves filters and custom options (0020) | Alan, Razin |

## New M4 features

| Feature | Status | What's there | What's missing | Owner |
|---|---|---|---|---|
| RSVP and "Did you go?" | Done | Plan time, RSVP, outcomes, sweep prompts, Winner screen. Known bugs: the first deploy prompts for old Picks, and the app and sweep ask at different times | | Alan |
| Frictionless invite link | Partial | Revocable, expiring tokens through the API, kept across sign-in; share from the Lobby | Not yet "one tap from iMessage": no web page or Universal Links, no group link in the app, no revoke in the app, and a link can skip the name step | Razin |
| Custom Plans | Partial | Typed options, templates, mixed with places, text filter, tested through the Pick flow | No location input, so Directions and saved custom options are unreachable; options can't be reported; Pick again retains them (0020) | Josh |
| "Looking to hang" | Partial | Posting and your own posts | Shared visibility, responding and "Let's pick" remain unavailable (503). **Recommend explicit M4 deferral/cut**: graph-backed RLS and atomic exact-down creation are still unwired; team decision pending | Josh |

## Sources

- Reviews with file references: the comments on PR #35.
- Requirement wording: `docs/design.md` (its table is as of M3).

## Josh M4 verification on current integration branch

Local changes below are not pushed/deployed. Apply 0021 before enabling them.

| Requirement | Result | Evidence or remaining boundary |
|---|---|---|
| priceMax/openNow/radius, Activities categories and bug #11 | Done | Shared openingHours logic; real/mocked bounds and Activities tests pass. Unknown price/hours correctly exclude a place under strict filters. No venue hours or free prices were invented. |
| Discover scoring, up to 20, no pagination | Done | Existing caller-profile pure scoring and route tests retained. |
| Cache-first owned searches and daily expiry cleanup | Fixed | Durable service-only place_cache plus atomic daily TTL claim/delete and removed count logging (0021). Google cache remains IDs only, not reusable display content. |
| Save/unsave/list, includeSaved priority/dedup | Fixed | Existing ID routes retained; category leak fixed in API and mocks, with radius/filter checks preserved. |
| Google-backed Pick creation, saved Google hydration, Google display cache hits | Deferred | Production Pick snapshots remain fixture/custom only. Approved Google retention/hydration and frozen ranking inputs are still required; no snapshot guard bypass. This is incomplete M4 scope unless explicitly deferred by the team. |
| Google daily cap and Pick create/start/refresh caps | Done | Existing atomic reservations and 429 behavior retained. |
| Discover cost control and empty fallback notice | Fixed | Separate 20 requests/user/UTC day before provider access; account deletion erases the new counter. Empty filtered fallback still reports fallback. |
| Client key safety | Fixed | __DEV__ guards retained, EAS profiles clear the demo public key; release export sentinel absent. Cloud key restrictions, hosted secrets and billing settings are not verified. |
| Custom Plans validation/templates/normal engine | Done | 2–20 options, shared text filter, six templates, normal four-option swipe/rank/vote completion retained. |
| Hang responses / Let's Pick | Deferred (recommended) | Team has not marked Cut. Own active post composition/listing works; shared visibility/response and exact-down creation still fail closed. Needs substantial authorization/RLS/atomic creation integration. No duplicate systems added. |
| Architecture, budget and privacy docs | Fixed | Updated decisions/design/privacy for 0021 and currently available teammate helpers. |

Local validation: lint and app TypeScript pass; 71 Jest suites / 672 tests pass;
Deno check passes and 69 route tests pass. Fresh non-cron migration replay and
29 standalone SQL assertions pass, including cache RLS, TTL/once-per-day behavior,
Discover quota/account deletion, saved limits, Custom Plans and Pick Again.
Full pgTAP/Supabase HTTP tests are unavailable locally (Docker/pgTAP absent);
0007's cron/Vault/net setup was excluded from the isolated PostgreSQL replay.
Android release export passes, with the non-secret public-key sentinel absent.
The remaining Google/Hang scope and hosted credential checks prevent a claim that
all original Josh M4 requirements are complete for unconditional approval.
