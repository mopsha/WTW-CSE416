# M3 demo script (Alan drives, Mike on phone 2)

Slide 2, **3:30**. Goal: one Pick end to end on two real phones, mirrored to the laptop.
Backup: the screen recording from the last dry run (open in a second tab before starting).

## Before the review (day of)

- [ ] `main` is deployed to wtw-dev; `GET /functions/v1/api/health` returns `{"status":"ok"}`.
- [ ] Both phones signed in (Alan = host, Mike = guest), Expo Go on the same build, phone 1 mirrored.
- [ ] Mock-mode switch (Josh) tested once, in case the network fails: if Places/wi-fi is down, flip it and say so.
- [ ] Do Not Disturb on both phones. Brightness up. Close other apps.
- [ ] Backup video open in a tab. If anything blocks for more than ~20 s, switch to it and narrate.

## Forcing the outcome

The result is deterministic, so pick the ending before you start:

| Want | Alan answers | Mike answers | Result |
|---|---|---|---|
| **Clear winner** (default) | Yes on the agreed place, No on the rest | the same | That place wins outright; the vote is skipped. |
| **Tied vote** | Yes on everything | Yes on everything | Everyone ties, auto-close → vote. Alan votes A, Mike votes B → tie → the better-ranked place wins, shown as a tie-break. |

Cards come in a different order on each phone (per-person shuffle), so match by **place name**, not
position. Agree on the winning place's name beforehand.

## Run (target times)

| Time | Phone | Do | Say |
|---|---|---|---|
| 0:00 | 1 | Picks → **+** → Food → drop the pin on SBU → radius ~3 mi → Create | "A Pick is one group decision. The host picks the center and radius." |
| 0:25 | 1 | Lobby: show the join code / QR → Share | "Friends join with a 6-character code, QR, or link." |
| 0:40 | 2 | Mike types the code → joins; phone 1 shows 2 participants | "Accounts are required; Mike is signed in." |
| 0:55 | 1 | **Start** | "Start pulls real nearby places into one fixed pool." |
| 1:05 | both | Swipe 3–4 cards each (forced answers above) | "Each person sees the same pool in a different order. Answers are private." |
| 1:40 | 2 | Mike **quits the app**, reopens → resumes at the next unanswered card | "Answers are saved on the server; reopening resumes where you were." |
| 2:00 | both | Finish swiping; waiting view shows "2 of 2 finished" | "Live progress shows counts, never anyone's answers." |
| 2:20 | — | Auto-close fires when the last person finishes (or Alan taps **Close now**) | "It closes three ways: the host, everyone finishing, or the deadline." |
| 2:35 | both | Results: **Clear winner!** (or the vote screen for the tied ending) | "If #1 leads by 10+ points the vote is skipped. Users see rank only, never scores." |
| 3:00 | both | Winner screen → **Directions** → back → Picks list shows it completed | "The winner is saved; it's still there after reopening." |

## If something goes wrong

- **Start returns "No places found":** the radius is too small or Places is down → flip mock mode, start again.
- **A phone shows a stale screen:** pull to refresh (the polling fallback catches up within 5 s).
- **Join fails, or anything else blocks for > 20 s:** switch to the backup video and keep narrating the same lines.

## Slide 5 — Decision: closing and deciding (Alan, 1:00)

- **Three ways to close, one function.** Host taps Close, enough people finish (the host's X%), or
  the deadline passes; all three call `closePick`, which is safe to run twice.
- **Missing = Maybe.** Someone who never answers doesn't block or sink a place.
- **Clear winner skips the vote** when #1 leads #2 by ≥ 10 points; otherwise a 30-minute vote among the top 3.
- **Ties are deterministic:** score → distance from the center → place id; a tied vote goes to the
  better rank and the app says it was a tie-break.
- **Dropped alternative:** always voting (slower, more taps) and random tie-breaks (not reproducible, not testable).
- **Show:** the edge-case table in `docs/design.md` (Pick state machine → Edge cases), every row backed by a test.
