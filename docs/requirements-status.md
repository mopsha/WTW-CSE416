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
| FR-04 | Create, name, manage a group | Done | Create, rename, delete, add and remove members, leave. Known bug: Pick again can re-add removed members | | Razin |
| FR-05 | Pick for selected friends or a saved group | Partial | Group Picks from the Picks tab and group screen | Choosing individual friends: `POST /picks/:id/invite` exists but no screen calls it | Razin |
| FR-06 | Category, location, radius, price, open status | Partial | Food, Activities, Custom, map pin, radius, price filter | Open now and Free can't match the mock places, so Start fails with no candidates and the draft can't be edited | Josh |
| FR-07 | Bounded nearby candidate pool | Partial | Pool building, cap and rate limits; Discover can use Google | Picks always use the 36 mock places around Stony Brook, so real places are Discover-only, and wtw-dev's provider setting is unconfirmed. Discover needs a per-user limit before Google is on | Josh |
| FR-08 | Join through the app or an invite link | Partial | Join codes, `wtw://` links, brute-force limit, lobby lock | No web page or Universal Links, no revoke in the app, and `wtw://` tapped from iMessage is untested | Razin |
| FR-09 | One answer per candidate, changeable | Done | Swipes, buttons, Back, Change my answers | | Alan, Mike |
| FR-10 | Answers persist and progress restores | Done | Server-saved answers, resume after reload | | Alan |
| FR-11 | Answers hidden until aggregation | Done | Counts only during swiping. After close, FR-14 reasons describe the group's answers, only in groups of 4 or more | | Mike, Razin |
| FR-12 | Close when everyone finishes or on timeout | Done | Host close, threshold auto-close, deadline sweep | | Alan, Josh |
| FR-13 | Deterministic scores, top three | Done | Shared ranking code with tests | | Alan |
| FR-14 | Plain-language reason, no numbers | Done | `explainRank`, shown on Results | | Alan |
| FR-15 | Vote among the three finalists | Done | Changeable vote, host close, deadline | | Alan, Mike |
| FR-16 | Tie-break, one winner, saved | Done | Tally, tie-break by rank, Winner screen | | Alan |
| FR-17 | Discover feed and saved interests | Partial | `GET /discover` scored by survey answers, filters, save and unsave | No screen lists saved places, no "That's today's 20" end state, and saved Google places are dropped from Picks | Josh, Mike |
| FR-18 | Completed Pick history | Partial | My history with winner, finalists and who went; Pick again | The group history route exists but nothing links to it. Pick again drops filters and custom options | Alan, Razin |

## New M4 features

| Feature | Status | What's there | What's missing | Owner |
|---|---|---|---|---|
| RSVP and "Did you go?" | Done | Plan time, RSVP, outcomes, sweep prompts, Winner screen. Known bugs: the first deploy prompts for old Picks, and the app and sweep ask at different times | | Alan |
| Frictionless invite link | Partial | Revocable, expiring tokens through the API, kept across sign-in; share from the Lobby | Not yet "one tap from iMessage": no web page or Universal Links, no group link in the app, no revoke in the app, and a link can skip the name step | Razin |
| Custom Plans | Partial | Typed options, templates, mixed with places, text filter, tested through the Pick flow | No location input, so Directions and saved custom options are unreachable; options can't be reported; Pick again drops them | Josh |
| "Looking to hang" | Partial | Posting and your own posts | Friends can't see posts, and responding and "Let's pick" return 503. First on the plan's cut list: **Josh to finish it or mark it Cut** | Josh |

## Sources

- Reviews with file references: the comments on PR #35.
- Requirement wording: `docs/design.md` (its table is as of M3).
