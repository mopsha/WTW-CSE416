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
| Google candidates in a Pick | `pick_candidates.snapshot` (Google place ID, category, coordinates) | Showing and ranking the Pick | Participants | Coordinates removed after 27 days; ID kept with the Pick | With the Pick |
| Invite links | `invite_links` (token, kind, target, `created_by`, expiry, uses) | Join by link | The creator (RLS); the server checks tokens | 7 days, then useless | Yes |
| Join attempts | `join_attempts` (user, code or link, time) | Rate-limiting guesses at codes and links | Nobody but the server | No cleanup job yet | Yes |
| Rate-limit events | `rate_limit_events` (user, action, time); `rate_limit_counters` (scope, subject = user or Pick id, bucket) | Abuse limits on friend requests, reports, invites, creates, starts, refreshes and Discover | Nobody but the server | No cleanup job yet | Events: yes. Per-user create/Discover counters explicitly removed on account deletion; Pick counters are not user-keyed |
| Blocks | `blocks` (blocker, blocked) | Keeping someone away from you | Only the blocker | Until unblocked | Yes |
| Reports | `reports` (reporter, target kind and id, reported person, reason text, a copy of a reported message, review time and note) | Moderation | Nobody but the server; the team reviews them in the Supabase dashboard (`docs/moderation.md`) | No general report-metadata retention rule; photo evidence uses configured expiry below | Yes: deleting the reporter's or the reported person's account erases the report and any message copy; retention rule still to decide |
| Hang posts | `hang_posts` (author, activity text, start/expiry, audience, group) | "Looking to hang" | Active author, accepted friends or current group members; blocked users excluded | Hidden after expiry; stored until account/group deletion (no cleanup job) | Yes |
| Hang responses | `hang_responses` (down / maybe / can't) | Replies to a hang post | Responder and post author, while currently authorized | With the post | Yes |
| Search cache | `place_cache` (search coordinates/radius/category, owned fixture content or Google IDs only) | Reuse owned searches without provider calls | Nobody but the server | Five-minute read TTL; expired rows deleted daily | No user identity stored; global query cache |
| Google usage | `provider_usage` (provider, day, call count) | Daily cap on Google Places | Nobody but the server | Indefinitely | Not personal data (no user id) |
| "Did you go?" launch time | `private.feature_launches` | Prompts only Picks decided after launch | Nobody but the server | Indefinitely | Not personal data |

## Group Ideas release candidate additions (0023–0031)

These rows extend/supersede the older feature-state descriptions above. They are
an implementation inventory, not published legal text. Use
[release-readiness.md](release-readiness.md) for deployment and manual privacy checks.

| Data | Where / purpose | Visibility | Retention / account deletion |
|---|---|---|---|
| Group Ideas | `group_ideas`: creator, group, title, food/activity type, description, location text, timestamps | Current group members; API validates mutations; creator edits/deletes, owner may delete | Until deleted; group/creator deletion cascades. Location text is not geocoded. No image/upload storage |
| Frozen Group Idea candidates | Existing Pick candidate snapshots; `picks.include_group_ideas` | Existing Pick participants; library membership is rechecked when committing a deck | Existing Pick history rules; library edit/deletion does not rewrite snapshots. Account attribution cleanup follows existing custom-candidate rules; shared historical text may remain |
| Direct group invitations | `group_invitations`: group, inviter, invitee, status, created/resolved times | Intended recipient/inviter while invitation eligibility remains; pending list is not membership | Resolved rows retained; no scheduled retention cleanup. Group or either account deletion cascades; only accept inserts membership |
| Username / favorites / metadata privacy | `profiles.username`, favorites, `share_profile_metadata` | Owner full; authenticated username/UUID discovery exposes only public identity, excluding blocks/deleting accounts; full profiles require accepted unblocked friendship; counts/favorites/mutual groups only with sharing enabled. Raw metadata columns are not granted to clients | Until edited/deleted; username normalized and unique; sharing off by default. New identity required; established username cannot be erased |
| Optional setup offer | `profiles.optional_setup_pending` | Owner through API only; never controls authorization | Until dismissed or account deleted; existing accounts are not forced through optional steps |
| Group chat | `group_messages`: group, sender, text, retry ID, time | Current members; blocked sender content filtered. API returns latest 50; bounded display is not storage deletion | Stored until message's group or sender account deleted. Leaving/removal revokes access without erasing prior messages |
| Direct conversations/messages | `direct_conversations`, `direct_messages`: pair, sender, text, retry ID, time | Pair only while accepted friends and unblocked; API latest 50 | Unfriend/block retains inaccessible history; accepted re-friend can reuse conversation. Either account deletion cascades conversation/messages |
| Message/invitation notifications | Existing `notifications` plus message foreign keys / routing IDs | Recipient only; authorization checked again at destination. Message push payloads contain routing IDs, not message text | Message deletion cascades linked notifications. Invitation resolution marks matching notifications read; account deletion removes recipient rows |
| Past Moves | `profile_past_moves` projection of completed Picks, winners and own `went=true`; no new feed table | Owner; friend requires metadata sharing, accepted/unblocked friendship and participation in same Pick. Group label requires viewer's current membership | Existing Pick/outcome retention; correcting attendance removes projected entry. Timed eligibility +1h, untimed +3h. Restricted Google display content omitted; deletion follows underlying records |

Chats and Group Ideas add user-generated content to the store disclosure review;
usernames add a public-facing identifier through authenticated, rate-limited identity discovery. These
features introduce no contacts, birthday or analytics collection. Managed profile photos
add uploaded user content as described below.

## For the App Store privacy labels (Mike, M5)

Draft mapping, to confirm against Apple's current categories in App Store Connect:

- **Contact info → Email address:** collected, linked to the user, used for app functionality (sign-in). Not tracking.
- **Identifiers → User ID:** collected, linked, app functionality.
- **Location → Precise location:** collected only when the host centers a Pick on their current location; linked (it's on their Pick); app functionality.
- **User content → Other user content:** display name, group names, cancel reasons, custom plan options and notes, hang posts, report text; linked; app functionality.
- **Usage data → Product interaction:** swipes, votes, RSVPs, "Did you go?"; linked; app functionality.
- **User content → Photos or Videos (draft):** selected profile photos; linked to account ID; app functionality. Confirm this selection and any moderation purpose in App Store Connect before submission. See [Apple’s data-type guidance](https://developer.apple.com/app-store/app-privacy-details/).
- **Tracking:** none. No third-party analytics or advertising SDKs.

## Managed profile photos (#49; implemented, release gates still open)

| Data                                  | Storage / purpose                                                                                                   | Visibility                                                                                                                                                                                                                                                                   | Retention / deletion                                                                                                                                                                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Profile photo                         | Private `profile-photos` bucket; canonical square JPEG, at most 512px / 1 MiB; source metadata stripped server-side | Owner, accepted friends, current shared groups, or shared Picks in `draft`, `swiping`, `ranking`, `final_vote`. Either-direction blocking overrides access; pending friendship alone is insufficient. Metadata-sharing settings do not control this separate photo audience. | Until replacement, removal or account deletion, except unexpired report evidence described below. Normal removal uses Storage API. Failed/incomplete candidates are eligible for a bounded hourly orphan batch after 24 hours; this is an eligibility threshold, not a deletion deadline. |
| Photo revision / internal path        | Private profile columns; ownership, atomic updates and revocation                                                   | Service-only internal fields; authorized API projections expose only user ID/revision                                                                                                                                                                                        | Account deletion cascades profile metadata. Old revisions cannot finalize after replacement or deletion intent.                                                                                                                         |
| Account-deletion intent / retry claim | `avatar_deletion_pending`, `avatar_delete_retry_at`; safely complete interrupted deletion                           | Server-only                                                                                                                                                                                                                                                                  | No automatic unfreeze after destructive or uncertain operations. Sweep claims up to five due accounts, retries after five minutes, and reports failures separately. Requires healthy maintenance scheduling.                            |
| Read quotas                           | Existing rate-limit counters; per-user minute buckets                                                               | Server-only                                                                                                                                                                                                                                                                  | Old photo buckets pruned on subsequent usage; account deletion removes that user's photo counters.                                                                                                                                      |

Downloaded images use account-scoped memory caching, with a 60-second authorization
lease measured from request start and checked on cache reads/render, focus/navigation,
and at 30-second intervals while foregrounded. A transient outage can retain already
authorized pixels until expiry is checked. Request completion, retries, and JS
scheduling affect visibility; this is not a hard post-revocation wall-clock maximum. Confirmed denial,
local block/remove events, sign-out and backgrounding invalidate immediately.
Already delivered pixels cannot be remotely erased from another user's device.

Photo-specific moderation is implemented but photo reports are disabled until the
team configures an approved retention interval and explicitly attests moderation readiness. Uploads/replacements share that server-enforced gate; retention alone is insufficient. `public.reports` now stores the
owner and exact revision, a private immutable evidence path, and an expiry; no
paths/bytes appear in client report responses. Existing report RLS and cascades
apply. Only existing authorized project operators using service credentials/SQL
editor can review evidence or remove a reported current revision. No mobile
moderator role or dashboard is introduced.

Evidence survives owner replacement/removal until the report expires or cascades.
Expired evidence cannot be retrieved through the operator RPC; physical deletion
uses the existing bounded orphan sweep and is not guaranteed at the expiry instant.
Active photos are not deleted just because evidence expires. Owner deletion uses
the existing Storage-before-Auth cleanup, including the evidence prefix. Reporter
deletion removes its report reference; other live reports may still pin that file.
General report metadata retains #44's existing lifecycle; no new indefinite image
retention default has been approved. Operator-downloaded copies require a separate,
team-approved handling/deletion policy.

See `moderation.md` for the actual workflow. PR #45 must update
`site/privacy.html`, review `site/terms.html` and `site/support.html`, and remove the
no-upload statement. Describe the actual photo audience, evidence access, expiry,
cleanup delays and deletion behavior. Photos or Videos/User Content label purpose,
linkage, retention and final policy language require human approval before release.


Review follow-up: authenticated capability state is account-scoped and short-lived;
no new server-side photo-view receipt/history is collected. Post-block/removal
revision-specific evidence reporting remains a bounded-receipt/grace-policy decision.
Generic user complaints remain permitted after blocking/group removal under #44;
they preserve no photo bytes or revision and grant no access. Privileged current-photo
review after evidence expiry never restores historical evidence or broadens ordinary
photo/profile access. Current removal appends an operational outcome to all exact-
revision reports while preserving notes; staff identity/access auditing is still an
approval gate. PR #45 must explain these actual distinctions and any subsequently
approved receipt retention before release; no permanent viewing history is assumed.

Capabilities are fetched on focus/resume and polled only while editor/report UI is
active, independently of avatar authorization checks. A 15-second polling interval
refreshes at 15 seconds or less remaining on the 30-second request-start lease;
expiry/failure remains fail-closed. Request completion and JS scheduling can still
delay updates. Disabled uploads hide the upload controls; existing owner photos
remain removable. No new viewing-history or retention policy was introduced.

Username discovery (0036): signed-in users can perform bounded prefix/UUID identity
lookups. The projection contains display name, username, UUID and the viewer's own
relationship; no email, favorites or private social statistics. Either-direction
blocks and pending deletion deny lookup. Existing avatar authorization is unchanged.
Public identity discovery is separate from the metadata-sharing preference. Lookup
counters use bounded minute buckets and are removed on account deletion. Native
sharing sends only public identity text and an ID-backed custom-scheme link to the
OS-selected recipient/app. A pending sign-in profile target is stored locally for
up to 24 hours and consumed once. Review corresponding disclosures before release;
no public web domain, universal-link service or new legal promise is introduced.
