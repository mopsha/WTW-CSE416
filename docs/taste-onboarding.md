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
prompts, and it never marks optional setup finished). Dismissal is stored on the device
(`wtw.tasteNudgeDismissed.v1`).

**Pick defaults** (`pickDefaults` in `src/lib/preferences.ts`): a new Pick starts with my single
category (if I picked exactly one), my budget and my distance. A Hang still starts as activities.

## PR 2: taste-aware Picks (backend, planned)

- Group taste score per candidate, computed when the host starts the Pick: liked members
  count +1 and disliked members count −1, normalized by group size. It uses the people actually
  in the Pick and is computed server-side only; nobody's preferences are shown to others.
- Deck: saved, custom and group-idea spots keep their priority. Provider results fill about 70%
  of the deck by taste and about 30% from the normal mix. Nothing is removed.
- Tiebreak: `pick_candidates.taste_score` is stored at build time (our own number, since Google
  snapshots keep no types). Rank order becomes score → taste → distance → placeId.
- "Matches your taste" badge on swipe cards, from my own liked types only.
- Quiet learning: `learned_taste(user_id, place_type, score)`, nudged by real swipes; explicit
  answers always win. "Reset what WTW learned" goes in preferences.
