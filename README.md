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

## Repo Structure

```
/M1        — Milestone 1 deliverables
README.md  — you're looking at it
```

## Status

🚧 Early development — Milestone 1 (Proposal & Requirements) in progress.

---
*Built for CSE 416, Fall 2026, at Stony Brook University.*
