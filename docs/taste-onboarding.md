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

**Tiebreak.** At start/refresh the API sends each candidate's `tasteScore` (only when non-zero).
`0047_taste_learning.sql` stores it in `private.pick_candidate_taste`, which the app can't read:
a group score could reveal someone's preferences in a two-person Pick. `pick_load_for_close`
adds it back for the API, and ranking becomes score → **taste** → distance → placeId. The final
vote's tie chain already follows rank order.

**Badge.** Each candidate snapshot carries `tasteType`, our survey label stored next to
`category`. The swipe card shows "Matches your taste" when that type is one I said I like. It
uses only my own answers. For Google places `tasteType` would be Google's place types, which
the Places terms don't let us store, so it's never saved: the API adds it to each read from the
live result (`pickPlaces.ts`). The deck order and tiebreak still use those types, but only as
the group's score, computed when the deck is built.

**Learning** (`taste_signals`, read through the `learned_taste` view; database triggers in 0047):

| Signal                 | Change                                                  |
| ---------------------- | ------------------------------------------------------- |
| Swipe Yes / Maybe / No | +1 / +0.3 / −1 (changing an answer replaces its signal) |
| Final vote             | +1 (changing your vote moves it)                        |
| Pick winner            | +2 for everyone in the Pick                             |

- Each signal is its own row, keyed by a hash of its swipe, ballot or winner, and halves every
  30 days. A type's score is their faded sum, capped at −10..10 after fading. Changing an answer replaces that
  row, so it never takes back more or less than the original added, even after a reset or decay.
- Only typed candidates teach; custom options and untyped places don't. Google places are
  untyped in storage (see Badge), so for now learning only comes from non-Google places. Making
  Google places teach would need the API to record signals from live types, or a check that
  storing the survey label is allowed.
- The learning runs in triggers, so every write path is covered and nothing else changes. It's
  best effort: a lock wait or other failure skips the signal instead of failing the swipe,
  vote, start or refresh.

**Preferences screen** (Profile → Preferences, or Settings → Food & activity preferences):

- "What WTW noticed" lists learned likes and passes that my answers don't already cover.
  `GET /me/learned-taste` returns the decayed scores and drops anything below 0.5.
- "Reset what WTW learned" (`DELETE /me/learned-taste`) clears the learning only.
- "Swipe again" reopens the practice deck, then returns to where it was opened from.

**Not yet**: "people like you also liked…" (collaborative filtering). That needs real usage
data first.
