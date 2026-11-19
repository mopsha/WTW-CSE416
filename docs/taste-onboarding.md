# Taste onboarding (owner: Alan)

New users learn WTW by doing it, and WTW learns what they like.

## PR 1: get-started flow (client)

**Intro (signed out, `app/intro.tsx`).** The three slides (Swipe, Decide together, Go) each play a
looping animation from `src/components/IntroScenes.tsx`: a card swiped Yes, three answers
stacking into a ranking, and a trophy popping with confetti. The scenes are decorative and
hidden from screen readers, because the slide text says the same. Reduce Motion shows a still frame.

**Onboarding (signed in, `app/onboarding.tsx`).** Steps: **location → taste → preferences →
notifications → done**. Every step can be skipped, and "Skip setup" still leaves at any point.
Location comes first so the practice swipe can show real places.

- **Taste** (`src/components/TasteSwipe.tsx`, logic in `src/lib/tasteDeck.ts`): 12 cards, 6 food
  and 6 activities, alternating. Each card teaches exactly one survey type:
  - With location: two `GET /discover` calls (food, activities). Each card is a real nearby place,
    labeled with the first survey type it has that no earlier card already used.
  - Without location, or with too few results: offline type cards ("Sushi", "Bowling", …).
  - Yes adds the type to `types` and ticks its category. No adds it to `dislikedTypes`. Maybe
    changes nothing.
- **Preferences**: the existing `PreferencesForm`, prefilled from the swipes. Save goes through
  `POST /me/preferences`. Price and distance are only asked here.

The free-text favorite cuisine/activity step was removed from onboarding. Those public profile
fields can still be edited on the profile.

**Activity dislikes.** `dislikedTypes` now accepts activity types as well as cuisines
(`_shared/domain/preferences.ts`). The form adds a "Things you'd rather skip" section.

**Home nudge** (`src/components/TasteNudge.tsx`): shown while preferences were never saved
(`onboarded` false). It opens `/onboarding?mode=taste` (taste + preferences only, no permission
prompts, and it never marks optional setup finished). Dismissal is stored per account on the device
(`wtw.tasteNudgeDismissed.v1.<userId>`).

**Pick defaults** (`pickDefaults` in `src/lib/preferences.ts`): a new Pick starts with my single
category (if I picked exactly one), my budget and my distance. A Hang still starts as activities.

## PR 2: taste-aware Picks and learning

**Group taste** (`_shared/domain/groupTaste.ts`, pure):

- Each place counts as one survey type, `tasteTypeOf(types)`: its first own Google type that is
  a survey type.
- Each member's value for a type runs from −1 to 1. Explicit likes and dislikes win; otherwise
  the learned score is used, capped at ±1 once it reaches 3.
- The group score is the average over everyone in the Pick when it starts.

**Deck** (`buildCandidates`): saved, custom and group-idea spots keep their priority. Then
`tasteOrder` gives about 70% of the provider slots to the best positive group matches, and the
rest keep the normal varied interleave. Nothing is removed. With no taste data the deck is
unchanged.

**Tiebreak.** At start/refresh the API sends a non-Google candidate's `tasteScore` (only when non-zero). Google classifications may reorder the current live deck but never produce persisted tiebreak scores.
`0047_taste_learning.sql` stores it in `private.pick_candidate_taste`, which the app can't read:
a group score could reveal someone's preferences in a two-person Pick. `pick_load_for_close`
adds it back for the API, and ranking becomes score → **taste** → distance → placeId. The final
vote's tie chain already follows rank order.

**Badge.** Each candidate snapshot carries `tasteType`, our survey label stored next to
`category`. The swipe card shows "Matches your taste" when that type is one I said I like. It
uses only my own answers. For Google places `tasteType` would be Google's place types, which
the Places terms don't let us store, so it's never saved: the API adds it to each read from the
live result (`pickPlaces.ts`). Live deck ordering still uses those types in memory. Migration 0049 and the API both exclude Google-derived numeric scores from persistence, so Google places have no learned group-taste ranking tiebreak. Their normal swipe/vote score, distance and ID tie rules remain.

**Learning** (`taste_signals`, read through the `learned_taste` view; database triggers in 0047):

| Signal                 | Change                                                  |
| ---------------------- | ------------------------------------------------------- |
| Swipe Yes / Maybe / No | +1 / +0.3 / −1 (changing an answer replaces its signal) |
| Final vote             | +1 (changing your vote moves it)                        |
| Pick winner            | +2 for everyone in the Pick                             |

- Each signal is its own row, keyed by a hash of its swipe, ballot or winner, and halves every
  30 days. A type's score is their faded sum, capped at −10..10 after fading. Changing an answer replaces that
  row, so it never takes back more or less than the original added, even after a reset or decay.
- Only typed candidates teach; custom options and untyped places don't.
- **Google places** (0056, `_shared/api/tasteSignals.ts`): their types are never stored with the
  place, so the triggers can't see them. Instead the API records the user's signal with the type
  it has live (agreed with Josh). Only the per-user "leaned toward <type>" signal is stored,
  marked `google`, and it's ignored after 30 days and deleted by the sweep (`purge_google_taste`),
  the same window as Google coordinates.
  - Swipes and votes: when the server shows a Google card (`getPick`) it adds `tasteProof`, an
    HMAC over user, Pick, place and type with a key derived from a server-only secret. The app
    sends both back; the API records only a type it signed for exactly that card and user.
  - Winners: recorded for the viewer when they next open the completed Pick, from the server's
    own live read (no proof needed, no extra Google calls), dated to `decided_at`.
  - `taste_record_google_signal` checks the user is in the Pick, the place is a Google
    candidate and the swipe, ballot or winner exists, and takes the weight and time from it.
  - Older apps send no type or proof; their Google swipes just don't teach.
- **Ordering and resets** (0056, all paths including the triggers): one per-user lock
  (`wtw-taste:<user>`) orders every learning write and every reset, and a recorder reads the
  swipe or ballot only after taking it, so the latest decision always wins. `taste_epochs.since`
  is when learning restarts: any action at or before it never teaches, however late its
  request arrives. Users who existed before 0056 start at the migration, since earlier resets
  left no record. Races are covered by `tests/db/google_taste_concurrency.py` (in CI).
- The learning runs in triggers, so every write path is covered and nothing else changes. It's
  best effort: a lock wait or other failure skips the signal instead of failing the swipe,
  vote, start or refresh.

**Preferences screen** (Profile → Preferences, or Settings → Food & activity preferences):

- "What WTW noticed" lists learned likes and passes that my answers don't already cover.
  `GET /me/learned-taste` returns the decayed scores and drops anything below 0.5.
- "Reset what WTW learned" (`DELETE /me/learned-taste`) clears the learning only and moves the user's epoch (`taste_reset`), so nothing from before it can teach again.
- "Swipe again" reopens the practice deck, then returns to where it was opened from.

**Not yet**: "people like you also liked…" (collaborative filtering). That needs real usage
data first.


## Forward hardening (0049)

[The fix report](taste-learning-fixes.md) describes UUID candidate generations, bounded optional cache work, active-Pick orphan cleanup, legacy provider-data cleanup and rollout sequencing. Migration 0047 is preserved; 0048 remains reserved by the photo PR. Deploy 0048 before 0049 or review migration ordering explicitly. Preview environments that already applied an older 0047 use the forward migration rather than rerunning edited migration text.
