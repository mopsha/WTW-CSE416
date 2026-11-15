import React from 'react';
import { Linking } from 'react-native';
import WinnerScreen from '../../app/pick/[id]/winner';
import { WinnerCard } from '@/components/ResultCards';
import { api } from '@/lib/api';
import { router } from 'expo-router';
import type { Candidate } from '@/lib/types';
const { act, create } = jest.requireActual('react-test-renderer');
let mockReveal: any;
let mockPlan: any;
jest.mock('@/hooks/useAuth', () => ({ useSession: () => ({ user: { id: 'me' } }) }));
jest.mock('@/hooks/usePickLive', () => ({
  usePickLive: () => ({ state: 'decided', progress: { participants: [] } }),
}));
jest.mock('@/hooks/usePickRoute', () => ({ usePickRoute: jest.fn() }));
jest.mock('@/hooks/useReveal', () => ({
  useReveal: () => ({ reveal: mockReveal, retry: jest.fn() }),
}));
jest.mock('@/hooks/usePrivateRefresh', () => ({
  usePrivateRefresh: (load: () => void) =>
    jest.requireActual('react').useEffect(() => {
      load();
    }, [load]),
}));
jest.mock('@/lib/api', () => ({
  api: {
    getPlan: jest.fn(),
    setPlanTime: jest.fn(),
    rsvp: jest.fn(),
    pickAgain: jest.fn(),
    recordOutcome: jest.fn(),
  },
}));
jest.mock('@/lib/googlePlaces', () => ({ useEnrichedPlace: (p: unknown) => p }));
jest.mock('expo-router', () => ({
  router: { replace: jest.fn() },
  useLocalSearchParams: () => ({ id: 'pick' }),
}));
jest.mock('@/components/Screen', () => ({
  Screen: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/components/Button', () => ({
  Button: (p: object) => jest.requireActual('react').createElement('kit-button', p),
}));
jest.mock('@/components/PlanTimeSheet', () => ({
  PlanTimeSheet: (props: object) => jest.requireActual('react').createElement('plan-sheet', props),
}));
jest.mock('@/components/PickParts', () => ({
  CenterMessage: () => null,
  FlameOrb: () => null,
  goToPicks: jest.fn(),
}));
const base: Candidate = {
  placeId: 'winner',
  name: 'A very long winning place name that wraps naturally',
  provider: 'mock',
  photoUrl: null,
  address: 'Main Street',
  cuisine: 'Food',
  priceLevel: 2,
  rating: null,
  lat: null,
  lng: null,
};
let tree: any;
const text = () => JSON.stringify(tree.toJSON());
const button = (label: string) =>
  tree.root.findAllByType('kit-button').find((n: any) => n.props.label === label);
async function mount() {
  await act(async () => {
    tree = create(<WinnerScreen />);
  });
}
beforeEach(() => {
  jest.clearAllMocks();
  mockPlan = {
    state: 'decided',
    isHost: true,
    planAt: new Date(Date.now() + 86400_000).toISOString(),
    participantCount: 3,
    rsvps: { going: 1, maybe: 0, notGoing: 1 },
    myRsvp: 'going',
    outcomes: { went: 0, didNotGo: 0, again: 0 },
    myOutcome: null,
  };
  jest.mocked(api.getPlan).mockImplementation(async () => mockPlan);
  mockReveal = {
    status: 'ready',
    pick: {
      winnerPlaceId: 'winner',
      decidedBy: 'vote',
      decidedAt: new Date().toISOString(),
      category: 'food',
    },
    places: new Map([
      ['winner', base],
      ['alternative', { ...base, placeId: 'alternative', name: 'Alternative' }],
    ]),
    ranking: [
      { placeId: 'alternative', rank: 1 },
      { placeId: 'winner', rank: 2 },
    ],
  };
});
afterEach(async () => {
  await act(async () => tree?.unmount());
  jest.restoreAllMocks();
});
test.each(['food', 'activities', 'mixed', 'custom'])(
  '%s renders the persisted winner even when another place ranks first',
  async (category) => {
    mockReveal.pick.category = category;
    if (category === 'custom')
      mockReveal.places.set('winner', {
        ...base,
        provider: 'custom',
        locationProvided: false,
        address: null,
      });
    await mount();
    expect(tree.root.findByType(WinnerCard).props.place.placeId).toBe('winner');
    expect(text()).toContain(base.name);
    expect(text()).toContain('Other favorites');
    expect(!!button('Get directions')).toBe(category !== 'custom');
    expect(text()).not.toContain('Did you go?');
    expect(text()).not.toContain('All 3 of you are in');
    expect(text()).toContain('1 going · 0 maybe · 1 can’t · 1 awaiting reply');
  },
);
test('tie resolution copy and Google attribution retain the persisted name', async () => {
  mockReveal.pick.decidedBy = 'tie_break';
  mockReveal.places.set('winner', {
    ...base,
    provider: 'google',
    attributions: [{ provider: 'Photo author' }],
    photoUrl: 'https://example.com/photo.jpg',
  });
  await mount();
  expect(text()).toContain('The vote was tied');
  expect(text()).toContain('Google Maps');
  expect(text()).toContain('Photo author');
  expect(text()).toContain(base.name);
});
test.each(['going', 'maybe', 'not_going'])('RSVP %s uses the existing API', async (status) => {
  await mount();
  const { Chips } = jest.requireActual('@/components/Chips');
  await act(async () => tree.root.findByType(Chips).props.onChange(status));
  expect(api.rsvp).toHaveBeenCalledWith('pick', status);
});
test('non-host has no scheduling or Pick Again control', async () => {
  mockPlan.isHost = false;
  await mount();
  expect(text()).not.toContain('edit scheduled time');
  expect(button('Pick again with the same group')).toBeUndefined();
});
test('attendance appears only once due and saves both answers', async () => {
  mockPlan.planAt = new Date(Date.now() - 2 * 3600_000).toISOString();
  await mount();
  expect(text()).toContain('Did you go?');
  await act(async () => button('I went').props.onPress());
  expect(api.recordOutcome).toHaveBeenCalledWith('pick', true);
  await act(async () => button('I didn’t go').props.onPress());
  expect(api.recordOutcome).toHaveBeenCalledWith('pick', false);
});
test('unscheduled attendance preserves the three-hour decision fallback', async () => {
  mockPlan.planAt = null;
  mockReveal.pick.decidedAt = new Date(Date.now() - 4 * 3600_000).toISOString();
  await mount();
  expect(text()).toContain('Did you go?');
});
test('Pick Again and alternatives keep their existing navigation', async () => {
  jest.mocked(api.pickAgain).mockResolvedValue({ pickId: 'next', state: 'draft' });
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  await mount();
  const { SmallResult } = jest.requireActual('@/components/ResultCards');
  await act(async () => tree.root.findByType(SmallResult).props.onPress());
  expect(open).toHaveBeenCalledTimes(1);
  await act(async () => button('Pick again with the same group').props.onPress());
  expect(api.pickAgain).toHaveBeenCalledWith('pick');
  expect(router.replace).toHaveBeenCalledWith('/pick/next');
});

test('host schedule control saves through the existing API only on confirmation', async () => {
  await mount();
  const { Card } = jest.requireActual('@/components/Card');
  const row = tree.root
    .findAllByType(Card)
    .find((n: any) => n.props.accessibilityLabel?.includes('edit scheduled time'));
  await act(async () => row.props.onPress());
  const sheet = tree.root.findByType('plan-sheet');
  expect(sheet.props.initial).toBe(mockPlan.planAt);
  expect(api.setPlanTime).not.toHaveBeenCalled();
  const next = new Date(Date.now() + 2 * 86400_000).toISOString();
  await act(async () => sheet.props.onSave(next));
  expect(api.setPlanTime).toHaveBeenCalledWith('pick', next);
  expect(api.getPlan).toHaveBeenCalledTimes(2);
});

test('initial result loading has only neutral placeholders, with no winner, success or plan actions', async () => {
  mockReveal = { status: 'loading' };
  let tree: any;
  await act(async () => {
    tree = create(<WinnerScreen />);
  });
  expect(
    tree.root.findAllByProps({ accessibilityLabel: 'Loading Pick results' }).length,
  ).toBeGreaterThan(0);
  expect(tree.root.findAllByType(WinnerCard)).toHaveLength(0);
  expect(tree.root.findAllByType('kit-button')).toHaveLength(0);
  expect(JSON.stringify(tree.toJSON())).not.toContain('Saved to your history');
  expect(api.getPlan).not.toHaveBeenCalled();
  await act(async () => tree.unmount());
});
