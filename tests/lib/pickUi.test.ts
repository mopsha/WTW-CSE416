import { pickDetailFromApi } from '@/lib/api';
import { isFailedStatus } from '@/lib/live';
import { candidateFromApi, openLabel } from '@/lib/places';
import {
  directionsUrl,
  nameList,
  pickTitle,
  progressLine,
  shareMessage,
  voteLine,
} from '@/lib/pickUi';
import { formatCountdown } from '@/lib/time';

const place = { name: 'Kung Fu Tea', address: '1009 Route 25A', lat: 40.92, lng: -73.12 };

describe('directionsUrl', () => {
  test('iOS opens Apple Maps at the coordinates', () => {
    expect(directionsUrl(place, 'ios')).toBe(
      'https://maps.apple.com/?daddr=40.92,-73.12&q=Kung%20Fu%20Tea',
    );
  });
  test('Android (and web) open Google Maps directions', () => {
    expect(directionsUrl(place, 'android')).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=40.92,-73.12',
    );
  });
  test('without coordinates it searches the name and address', () => {
    const url = directionsUrl({ ...place, lat: null, lng: null }, 'android');
    expect(url).toContain('destination=Kung%20Fu%20Tea%2C%201009%20Route%2025A');
  });
});

test('nameList', () => {
  expect(nameList([])).toBe('');
  expect(nameList(['Ava'])).toBe('Ava');
  expect(nameList(['Ava', 'Ben', 'Cam'])).toBe('Ava, Ben and Cam');
  expect(nameList(['Ava', 'Ben', 'Cam', 'Dee', 'Eli'])).toBe('Ava, Ben and 3 others');
});

test('progress and vote lines are counts only', () => {
  expect(progressLine({ doneCount: 3, total: 5 })).toBe('3 of 5 finished swiping');
  expect(progressLine({ doneCount: 5, total: 5 })).toBe('Everyone’s done 🔥');
  expect(voteLine({ votedCount: 1, total: 4 })).toBe('1 of 4 voted');
  expect(voteLine({ votedCount: 4, total: 4 })).toBe('Everyone voted');
});

test('share message carries the code and the deep link', () => {
  expect(shareMessage('K7P2QX')).toContain('K7P2QX');
  expect(shareMessage('K7P2QX')).toContain('wtw://join/K7P2QX');
});

test('pickTitle', () => {
  expect(pickTitle('food')).toBe('Food Pick');
  expect(pickTitle('activities')).toBe('Activities Pick');
});

describe('formatCountdown', () => {
  test.each([
    [75_000, '1:15 left'],
    [59_001, '1:00 left'],
    [2 * 3600_000 + 5 * 60_000, '2h 05m left'],
    [26 * 3600_000, '1d 2h left'],
    [0, 'Time’s up'],
    [-5, 'Time’s up'],
    [NaN, 'Time’s up'],
  ])('%p -> %p', (ms, label) => expect(formatCountdown(ms)).toBe(label));
});

test('Realtime statuses that mean "poll instead"', () => {
  expect(isFailedStatus('SUBSCRIBED')).toBe(false);
  expect(isFailedStatus('CHANNEL_ERROR')).toBe(true);
  expect(isFailedStatus('TIMED_OUT')).toBe(true);
  expect(isFailedStatus('CLOSED')).toBe(true);
});

describe('candidateFromApi (GET /picks/:id snapshots)', () => {
  test('reads placeId, or the provider id, from the snapshot', () => {
    expect(candidateFromApi({ placeId: 'p1', name: 'A' }).placeId).toBe('p1');
    expect(candidateFromApi({ id: 'g1', name: 'B' }).placeId).toBe('g1');
  });
  test('keeps open-now info when the server sends it', () => {
    const c = candidateFromApi({ placeId: 'p1', name: 'A', openNow: true, closesAt: null });
    expect(c.openNow).toBe(true);
    expect(openLabel(c)).toBe('Open now');
    expect(openLabel({ openNow: false })).toBe('Closed now');
    expect(openLabel({})).toBeNull();
  });
  test('a malformed snapshot never crashes the deck', () => {
    expect(candidateFromApi(null)).toMatchObject({ placeId: '', name: 'Unnamed place' });
  });
});

describe('pickDetailFromApi', () => {
  const raw = {
    id: 'p',
    state: 'completed' as const,
    category: 'food' as const,
    center: { lat: 0, lng: 0 },
    radiusM: 1000,
    poolSize: 2,
    deadlineAt: null,
    closeThreshold: 100,
    isHost: true,
    participantCount: 2,
    candidates: [
      { placeId: 'a', name: 'A' },
      { placeId: 'b', name: 'B' },
    ],
    myAnswers: {},
    winnerPlaceId: 'a',
    decidedAt: null,
    decidedBy: 'clear_winner' as const,
  };

  test("merges the server's opening hours onto each place", () => {
    const pick = pickDetailFromApi({
      ...raw,
      candidateHours: [{ placeId: 'a', openNow: true, closesAt: '2026-10-21T02:00:00Z' }],
    });
    expect(pick.candidates[0]).toMatchObject({ placeId: 'a', openNow: true });
    expect(pick.candidates[1]).toMatchObject({ placeId: 'b', openNow: null });
    expect(pick).not.toHaveProperty('candidateHours');
  });

  test('works without hours (before the hours route is deployed)', () => {
    expect(pickDetailFromApi(raw).candidates.map((c) => c.placeId)).toEqual(['a', 'b']);
  });
});
