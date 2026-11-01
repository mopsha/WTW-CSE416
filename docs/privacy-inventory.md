# Privacy data inventory (Alan, M4)

Every piece of personal data WTW stores, why, who can see it, how long it is kept, and whether
it goes away when the account is deleted. Built from the migrations on `main` + Alan's 0009 and
0013 (Oct 30, 2026). **This is the source for the App Store privacy labels (Mike), the privacy
policy (Razin) and account deletion (Razin, 0017).** Update it in the same PR as any migration
that stores something new about a person.

"Deleted with the account" means the row is removed by a cascade from `auth.users` →
`profiles` (`on delete cascade`). Nothing here is sold, shared with advertisers, or used for
tracking. Nothing is sent to analytics; there is no analytics SDK.

## On `main` today (+ 0009, 0013)

| Data | Where | Why we keep it | Who can see it | Kept | Deleted with the account? |
|---|---|---|---|---|---|
| Email address | `auth.users.email` (Supabase Auth) | Sign-in with a one-time code | Only Supabase Auth and the server; never sent to other users, not in `profiles` | Until the account is deleted | Yes |
| Display name | `profiles.display_name` | So friends see who's in a Pick | You, and people who share a Pick with you (RLS) | Until changed or deleted | Yes |
| Avatar URL | `profiles.avatar_url` | Profile picture (not used yet) | Same as display name | Same | Yes |
| Picks you host | `picks` (`host_id`, category, center lat/lng, radius, deadline, settings, winner, `cancel_reason`, `plan_at`) | Running the Pick | Participants of that Pick | Indefinitely (history) | **Yes, and that deletes the Pick for everyone** (`picks.host_id` cascades). Razin/Alan: decide whether to cancel unfinished ones and keep completed ones with "Deleted user" (see M4 plan) |
| Pick center (a location) | `picks.center_lat/lng` | Finding places near the group | Participants | With the Pick | With the Pick |
| Being in a Pick | `pick_participants` (joined, finished time) | Who's in, live progress | Participants of that Pick | With the Pick | Yes |
| Your swipes | `preferences` (Yes/Maybe/No per place) | Ranking | **Only you** (RLS); the server uses them to score; reasons use counts only | With the Pick | Yes |
| Your final vote | `final_votes` | The tie-break vote | **Only you** | With the Pick | Yes (via `pick_participants`) |
| Ranking | `ranking_results` (rank, finalist, score) | Showing results | Participants see rank + finalist; scores are never sent to the app | With the Pick | With the Pick |
| Join codes | `pick_join_codes` | Joining by code/QR | Participants | 7 days, then useless | With the Pick |
| Notifications | `notifications` (type, Pick, small payload such as a cancel reason) | In-app inbox | **Only you** | Indefinitely (no cleanup job yet) | Yes |
| Push token | `push_tokens` (Expo token, platform) | Sending push notifications to your phone | Nobody but the server | Until the phone switches account, Expo reports it dead, or the account is deleted | Yes |
| RSVP | `pick_rsvps` (going / maybe / not going) | Planning after the winner | **Only you** (RLS); the group sees counts | With the Pick | Yes |
| "Did you go?" | `pick_outcomes` (went, would go again) | Measuring whether the plan happened | **Only you** (RLS); the group sees counts | With the Pick | Yes |

Device location: the app asks for location **only** to center a Pick or Discover near you
("when in use"). The exact location is not stored except as the Pick center the host chose.

## Coming in open PRs (owners: add your rows when the PR merges)

| PR | Data | Owner |
|---|---|---|
| #24 friends (0008) | `friendships` (requests, accepted, blocked) | Razin / Mike |
| #29 onboarding (0011) | `profiles.discover_preferences` (cuisines, budget, distance, activities) | Mike |
| #26 / #27 discover (0010) | `saved_places`, provider usage counters | Josh |
| #27 custom plans + hang (0015, 0016) | typed plan options (user text), hang posts and responses | Josh |
| #30 groups (0012) | `groups`, `group_members`, `picks.group_id` | Razin |
| invites, reports, deletion (0014, 0017) | invite tokens, reports (user text), deletion | Razin |

## For the App Store privacy labels (Mike, M5)

Draft mapping, to confirm against Apple's current categories in App Store Connect:

- **Contact info → Email address:** collected, linked to the user, used for app functionality (sign-in). Not tracking.
- **Identifiers → User ID:** collected, linked, app functionality.
- **Location → Precise location:** collected only when the host centers a Pick on their current location; linked (it's on their Pick); app functionality.
- **User content → Other user content:** display name, cancel reasons, and (after #27) custom plan options and hang posts; linked; app functionality.
- **Usage data → Product interaction:** swipes, votes, RSVPs, "Did you go?"; linked; app functionality.
- **Tracking:** none. No third-party analytics or advertising SDKs.
