# Discover photo lifecycle

The photo manager is active presentation state, not a reusable Google photo-name or
image cache. Google explicitly prohibits caching photo names and says expired names
must be obtained again through Search or Details. Its policies do not establish a
blanket 50-minute permission to cache returned URLs.

- Names from a current authorized Discover response are registered behind opaque
  handles. No names, image bytes, or URLs are written to disk by this manager.
- A name is consumed once, removed from its handle before resolution, and retained
  as a deduplication key only while that request is pending. Settled requests remove
  that key. Hung resolutions time out after 15 seconds; late results are ignored.
  A fresh response can supply a new name for the same place.
- Unused current-response metadata is discarded after five minutes. Successful
  active-presentation URLs are discarded after 50 minutes; failures after five.
  These are conservative engineering bounds, not licensing allowances or guarantees
  of Google's resource lifetime. Provider rejection also remains a normal failure.
- Expired/failed references are never replayed. Visible consumers first refresh their
  existing authorized Discover query (the onboarding flow uses its existing two
  category queries), then resolve only visible/current-and-next photos. Metadata
  refresh failures are retried at most once per five minutes while visible.
- Resolved results are not shared across remounts. Unmount and replacement responses
  release their handles. Only simultaneous resolutions in the same auth generation
  are shared. Auth changes invalidate all handles and pending lookups; late results
  cannot revive them. Requests use the existing viewer-scoped authentication check.
- The 200-entry LRU bounds presentation entries; expiry timers erase retained values.
  Visibility, route focus and foreground return revalidate through the same manager.
  Background/offscreen consumers do not initiate photo or metadata refresh work.

This gives up resolved-photo reuse across remounts/filters and may increase Search
and Photo calls compared with a reusable session cache. Partial browsing and
one-card-ahead loading still avoid eagerly resolving the whole feed. Existing shared
photo and Discover quotas remain authoritative; exhaustion leaves placeholders.

## Release checks

Sources: https://developers.google.com/maps/documentation/places/web-service/place-photos
and https://developers.google.com/maps/documentation/places/web-service/policies .

This implementation does not assert blanket Google licensing compliance. Confirm the
app's applicable agreement and any platform image-cache behavior before release.
Existing Discover tile attribution and photographer-link gaps remain release-blocking
follow-up work; this change preserves existing credit presentation and keeps each
new image paired with credits from its own response. TasteSwipe keeps author links.
Verify attribution, URL expiry, background return, rapid scrolling/swiping, offline
recovery and account switching on iOS and Android devices.
