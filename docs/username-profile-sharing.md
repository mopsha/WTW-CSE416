# Username discovery and profile sharing

Migration 0036 is additive after 0035. It retains the existing unique
`lower(username)` index and profile UUIDs. New/changed database claims are trimmed,
lowercased and validated as 3–24 ASCII letters/digits/underscores. Onboarding,
editing and lookup share the API normalizer; one leading @ is accepted by the API.
Empty/invalid claims are rejected. Established usernames cannot be erased through
the existing profile-update RPC. Existing accounts without required identity use
the existing welcome/identity flow; no second profile row is created.

New reserved claims: admin, administrator, support, moderator, wtw, official,
system. No migration silently renames existing accounts. Existing reserved claims
are grandfathered for unchanged-name metadata/privacy edits. The API verifies the
current owner profile before allowing that exception; body-supplied context cannot
grant it, and the database still rejects a different/new reserved claim. The team can review the reserved list before deployment.

Authenticated GET /friends/search?q= uses exact/prefix username matching, optional
@ and case normalization, minimum 3 characters, at most 10 rows, no pagination.
GET /people/:id shares the same atomic 30/minute viewer budget, including failed
UUID lookups. Both exclude either-direction blocks and deletion-pending targets.
Returned fields: UUID, display name, username, viewer relationship and an optional
authorized avatar reference. No email, favorites, social counts, private metadata,
Storage URL or evidence is returned. Metadata-sharing settings remain separate;
public identity is discoverable to signed-in users. This does not unlock the
friends-only full-profile/Past Moves API.

POST /friends/username-requests binds the selected UUID and displayed username;
stale/reassigned usernames cannot add a different person. It consumes the existing
20/day friend-request quota and reuses the canonical friend RPC/locking/block
trigger. Replies remain neutral `sent`; current relationship comes from lookup.
Incoming Respond opens the existing requests UI. Older email-based request builds
remain compatible with their existing non-enumerating response. Email login and
group invitation contracts are unchanged. Service-only internal email resolution
is not returned to clients or offered as a lookup endpoint.

Profile sharing uses React Native Share.share. Links are `wtw://p/<UUID>` and keep
working after username changes. Only display name/username and the link are shared.
iOS gets native message+url; Android gets the URL within its text payload. Share
cancellation is not reported as an error or a successful recipient delivery.

The unguarded /p/:id entry parks a validated target in the existing SecureStore
pattern when sign-in/identity setup is needed. The root resumes it after required
identity and optional setup routing. Local pending intent is bounded to 24 hours,
is consumed once, and can fall back to memory if SecureStore is unavailable.
Malformed/deleted/blocked targets fail without exposing private metadata. A shared
link is neither a friend invitation capability nor authorization for a photo.

There is no configured public HTTPS domain/associated-domain deployment here.
These custom-scheme links require an installed WTW build registering `wtw`;
Expo Go, app-not-installed landing pages, browser previews and Universal/App Links
are not claimed. A verified owned domain, hosted fallback, Apple association file,
Android asset links and native configuration/builds would be separate prerequisites
for HTTPS links. The mock account's non-UUID fixture ID cannot produce a production
share link; real profile UUIDs are required.

Before release: review discovery/privacy disclosures and reserved names; deploy
0036 with the API; run real Supabase HTTP/SQL tests and native sharing/deep-link QA
on both platforms, including cold start, sign-in/OTP return, missing usernames,
blocks/deletion, Dynamic Type and cancellation. Jest mocks do not verify OS share
sheet contents or Universal Links. No changes here enable photo moderation/uploads.


Review follow-up: the Friends screen owns Add Friend sheet handoffs. iOS waits for
native onDismiss; Android uses a nonanimated committed hide because RN exposes no
Android onDismiss callback. Only then are Requests or the selected profile opened.
Request busy state spans submission and awaitable reconciliation; permanent labels
come only from server relationships, including declined/neutral outcomes. Pending
profile set/take operations are serialized (results are not shared), and stale root
work cannot navigate after cleanup. An interrupted intent is restored unless a
newer link superseded it. Native modal/keyboard behavior still needs device QA.
