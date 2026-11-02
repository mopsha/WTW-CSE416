# Privacy data inventory (Alan, M4)

Every piece of personal data WTW stores, why, who can see it, how long it is kept, and whether
it goes away when the account is deleted. Built from the migrations on `main` + Alan's 0009 and
0013 (Oct 30, 2026), extended for everything on `integ/m4` through 0019 (Nov 1, 2026). **This is the source for the App Store privacy labels (Mike), the privacy
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

## Added by the M4 integration (0008, 0010–0019)

Account deletion (0017) runs a trigger on `profiles` before the cascade: unfinished Picks the
person hosted are canceled, completed ones are kept with `host_id = null` ("Deleted user"), and
hosted Picks nobody else is in are deleted. The Picks rows above follow that rule, not a plain
cascade.

| Data | Where | Why we keep it | Who can see it | Kept | Deleted with the account? |
|---|---|---|---|---|---|
| Friendships | `friendships` (requester, addressee, pending/accepted, times) | Friends list, adding friends to Picks | The two people; a pending request only by the person it was sent to (0018) | Until removed | Yes |
| Discover preferences | `profiles.discover_preferences`, `preferences_updated_at` (cuisines, budget, distance, activities) | Onboarding survey, Discover ordering | Only you | Until changed | Yes |
| Saved places | `saved_places` (place id) | Saved list, "include saved" in a Pick | Only you | Until unsaved | Yes |
| Groups you own / are in | `groups` (name, owner), `group_members` (role, joined) | Repeat Picks with the same people | Members of that group | Until left or removed | Yes; groups you own are deleted, their Picks stay without a group |
| Group of a Pick | `picks.group_id` | Group history | Participants | With the Pick | Set to null when the group goes |
| Pick filters and Custom Plan | `picks.price_max`, `open_now`, `include_saved`, `mix_category`, `custom_options` (option name, optional note and location, `createdBy`) | Running the Pick, Pick again | Participants | With the Pick | **Partly.** The creator id is stripped; the option text stays on other people's Picks. Open team decision (integ/m4 review item 8, App Store 5.1.1(v)) |
| Custom places | `places` rows with `source = 'custom'`, `created_by` | Candidates for a Custom Plan | Participants of Picks that use them | With the Picks | Creator stripped; text stays (same decision) |
| Invite links | `invite_links` (token, kind, target, `created_by`, expiry, uses) | Join by link | The creator (RLS); the server checks tokens | 7 days, then useless | Yes |
| Join attempts | `join_attempts` (user, code or link, time) | Rate-limiting guesses at codes and links | Nobody but the server | No cleanup job yet | Yes |
| Rate-limit events | `rate_limit_events` (user, action, time); `rate_limit_counters` (scope, subject = user or Pick id, bucket) | Abuse limits on friend requests, reports, invites, creates, starts | Nobody but the server | No cleanup job yet | Events: yes. Counters: no user FK, kept until the bucket expires |
| Blocks | `blocks` (blocker, blocked) | Keeping someone away from you | Only the blocker | Until unblocked | Yes |
| Reports | `reports` (reporter, target kind and id, reason text) | Moderation | Nobody but the server (Razin reviews in the dashboard) | No retention rule yet | Yes, **which also erases the report**; retention rule still to decide |
| Hang posts | `hang_posts` (author, activity text, start/expiry, audience, group) | "Looking to hang" | Today only the author (friend/group audience not finished) | Until expired; no cleanup job yet | Yes |
| Hang responses | `hang_responses` (down / maybe / can't) | Replies to a hang post | The post's author and you | With the post | Yes |
| Google usage | `provider_usage` (provider, day, call count) | Daily cap on Google Places | Nobody but the server | Indefinitely | Not personal data (no user id) |
| "Did you go?" launch time | `private.feature_launches` | Prompts only Picks decided after launch | Nobody but the server | Indefinitely | Not personal data |

## For the App Store privacy labels (Mike, M5)

Draft mapping, to confirm against Apple's current categories in App Store Connect:

- **Contact info → Email address:** collected, linked to the user, used for app functionality (sign-in). Not tracking.
- **Identifiers → User ID:** collected, linked, app functionality.
- **Location → Precise location:** collected only when the host centers a Pick on their current location; linked (it's on their Pick); app functionality.
- **User content → Other user content:** display name, group names, cancel reasons, custom plan options and notes, hang posts, report text; linked; app functionality.
- **Usage data → Product interaction:** swipes, votes, RSVPs, "Did you go?"; linked; app functionality.
- **Tracking:** none. No third-party analytics or advertising SDKs.
