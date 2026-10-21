import { answerFromDb, clearWinner, rankCandidates } from '@shared/domain/ranking.ts';

import { DEMO_CENTER, MOCK_PLACES, OTHER_PARTICIPANT_ANSWERS } from '@/lib/mock/fixtures';
import type { PreferenceValue } from '@/lib/types';

// DEMO: the three friends only say Yes to Tiger Lily Café, so it must win however you swipe.
const candidates = MOCK_PLACES.map((p) => ({ placeId: p.placeId, lat: p.lat, lng: p.lng }));
const tigerLily = MOCK_PLACES.find((p) => p.name.startsWith('Tiger Lily'))!;

function decide(mine: (i: number) => PreferenceValue) {
  const answers = [
    ...candidates.map((c, i) => ({ placeId: c.placeId, answer: answerFromDb(mine(i)) })),
    ...OTHER_PARTICIPANT_ANSWERS.flatMap((row) =>
      row.map((v, i) => ({ placeId: candidates[i]!.placeId, answer: answerFromDb(v) })),
    ),
  ];
  return clearWinner(
    rankCandidates(candidates, answers, OTHER_PARTICIPANT_ANSWERS.length + 1, DEMO_CENTER),
  );
}

describe('demo fixture: Tiger Lily Café always wins', () => {
  const tlIndex = MOCK_PLACES.indexOf(tigerLily);

  test.each<[string, (i: number) => PreferenceValue]>([
    ['you say Yes to everything', () => 2],
    ['you say No to everything', () => 0],
    ['you say Maybe to everything', () => 1],
    ['worst case: No on Tiger Lily, Yes on everything else', (i) => (i === tlIndex ? 0 : 2)],
    [
      'the demo script',
      (i) => ([0, 2, 14].includes(i) ? 2 : [3, 4, 7, 11, 13, 15, 19].includes(i) ? 1 : 0),
    ],
  ])('%s', (_label, mine) => {
    const decision = decide(mine);
    expect(decision.kind).toBe('winner');
    expect(decision.kind === 'winner' && decision.winner.placeId).toBe(tigerLily.placeId);
  });
});
