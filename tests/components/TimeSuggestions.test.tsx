import React from 'react';
import { TimeSuggestions } from '@/components/TimeSuggestions';
import { Button } from '@/components/Button';
import { PlanTimeSheet } from '@/components/PlanTimeSheet';
import { api } from '@/lib/api';
import type { TimeSuggestions as Value } from '@shared/api/timeSuggestions.ts';
const { create, act } = jest.requireActual('react-test-renderer');
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/lib/haptics', () => ({ haptic: { tap: jest.fn(), error: jest.fn() } }));
let mockLoad: () => Promise<void>;
let mockClear: () => void;
jest.mock('@/hooks/usePrivateRefresh', () => ({
  usePrivateRefresh: (load: () => Promise<void>, clear: () => void) => {
    const R = jest.requireActual('react');
    mockLoad = load;
    mockClear = clear;
    R.useEffect(() => {
      void load();
      return clear;
    }, [load, clear]);
  },
}));
jest.mock('@/lib/api', () => ({
  api: {
    getPickCapabilities: jest.fn(),
    getTimeSuggestions: jest.fn(),
    suggestTime: jest.fn(),
    actOnTimeSuggestion: jest.fn(),
  },
}));
jest.mock('@/components/PlanTimeSheet', () => ({ PlanTimeSheet: () => null }));
const base = (): Value => ({
  revision: 1,
  planAt: '2026-12-01T19:00:00Z',
  isHost: true,
  suggestions: [
    {
      id: 'suggestion',
      proposerId: 'friend',
      displayName: 'Friend',
      planAt: '2026-12-02T19:00:00Z',
      revision: 1,
      status: 'pending',
    },
  ],
});
let tree: ReturnType<typeof create>;
const changed = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
const button = (label: string) =>
  tree.root
    .findAllByType(Button)
    .find((n: { props: { label: string } }) => n.props.label === label);
const render = () =>
  act(async () => {
    tree = create(
      <TimeSuggestions
        pickId="pick"
        viewerId="viewer"
        planAt={base().planAt}
        onChanged={changed}
      />,
    );
  });
beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(api.getPickCapabilities)
    .mockResolvedValue({ availabilityFirst: false, timeSuggestions: true });
  jest.mocked(api.getTimeSuggestions).mockResolvedValue(base());
  jest.mocked(api.suggestTime).mockResolvedValue({ id: 'created' });
  jest.mocked(api.actOnTimeSuggestion).mockResolvedValue({ id: 'suggestion' });
});
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
});
test('feature disabled or missing hides the control without fetching suggestions', async () => {
  jest.mocked(api.getPickCapabilities).mockResolvedValue({ availabilityFirst: false });
  await render();
  expect(tree.toJSON()).toBeNull();
  expect(api.getTimeSuggestions).not.toHaveBeenCalled();
});
test('native editor shows authoritative time and explains suggestion semantics', async () => {
  await render();
  await act(async () => button('Suggest another time').props.onPress());
  const sheet = tree.root.findByType(PlanTimeSheet);
  expect(sheet.props.initial).toBe(base().planAt);
  expect(sheet.props.submitLabel).toBe('Submit suggestion');
  expect(sheet.props.explanation).toContain('Only the host');
  await act(async () => sheet.props.onSave('2026-12-03T19:00:00Z'));
  expect(api.suggestTime).toHaveBeenCalledWith('pick', '2026-12-03T19:00:00Z', 1, 'viewer');
  expect(changed).toHaveBeenCalled();
});
test('host acceptance uses displayed revision and refreshes the plan', async () => {
  await render();
  await act(async () => button('Accept this time').props.onPress());
  expect(api.actOnTimeSuggestion).toHaveBeenCalledWith('pick', 'suggestion', 'accept', 1, 'viewer');
  expect(changed).toHaveBeenCalled();
});
test('observer cannot see an accept control; proposer can withdraw', async () => {
  jest.mocked(api.getTimeSuggestions).mockResolvedValue({
    ...base(),
    isHost: false,
    suggestions: [{ ...base().suggestions[0]!, proposerId: 'viewer' }],
  });
  await render();
  expect(button('Accept this time')).toBeUndefined();
  expect(button('Withdraw')).toBeDefined();
});
test('blur clears protected data and ignores a late load', async () => {
  let finish!: (v: Value) => void;
  await render();
  jest.mocked(api.getTimeSuggestions).mockReturnValueOnce(
    new Promise((r) => {
      finish = r;
    }),
  );
  let pending!: Promise<void>;
  await act(async () => {
    pending = mockLoad();
  });
  await act(async () => mockClear());
  await act(async () => {
    finish(base());
    await pending;
  });
  expect(tree.toJSON()).toBeNull();
});
test('unmounted editor cannot start a late mutation', async () => {
  await render();
  await act(async () => button('Suggest another time').props.onPress());
  const save = tree.root.findByType(PlanTimeSheet).props.onSave;
  await act(async () => tree.unmount());
  await expect(save('2026-12-03T19:00:00Z')).rejects.toThrow('Refresh');
  expect(api.suggestTime).not.toHaveBeenCalled();
});
test('authorization loss clears names and hides controls', async () => {
  await render();
  jest
    .mocked(api.getTimeSuggestions)
    .mockRejectedValueOnce(Object.assign(new Error('Denied'), { status: 404 }));
  await act(async () => mockLoad());
  expect(tree.toJSON()).toBeNull();
});
test('pending acceptance finishes after navigation without refreshing the old screen', async () => {
  let finish!: (v: { id: string }) => void;
  jest.mocked(api.actOnTimeSuggestion).mockReturnValueOnce(
    new Promise((r) => {
      finish = r;
    }),
  );
  await render();
  await act(async () => button('Accept this time').props.onPress());
  await act(async () => tree.unmount());
  await act(async () => finish({ id: 'suggestion' }));
  expect(changed).not.toHaveBeenCalled();
});

test('mixed pending and historical rows preserve actions on an older pending proposal', async () => {
  jest.mocked(api.getTimeSuggestions).mockResolvedValue({
    ...base(),
    suggestions: [
      { ...base().suggestions[0]!, id: 'older-pending' },
      ...Array.from({ length: 50 }, (_, i) => ({
        ...base().suggestions[0]!,
        id: `history-${i}`,
        status: 'superseded' as const,
      })),
    ],
  });
  await render();
  const accepts = tree.root
    .findAllByType(Button)
    .filter((n: { props: { label: string } }) => n.props.label === 'Accept this time');
  expect(accepts).toHaveLength(1);
  await act(async () => accepts[0]!.props.onPress());
  expect(api.actOnTimeSuggestion).toHaveBeenCalledWith(
    'pick',
    'older-pending',
    'accept',
    1,
    'viewer',
  );
});

test('mixed listing keeps every pending action and gives historical rows no actions', async () => {
  const pending = Array.from({ length: 51 }, (_, i) => ({
    ...base().suggestions[0]!,
    id: `pending-${i}`,
    proposerId: i === 0 ? 'viewer' : `friend-${i}`,
  }));
  const history = Array.from({ length: 50 }, (_, i) => ({
    ...base().suggestions[0]!,
    id: `history-${i}`,
    status: 'superseded' as const,
  }));
  jest.mocked(api.getTimeSuggestions).mockResolvedValue({
    ...base(),
    suggestions: [...pending, ...history],
  });
  await render();
  expect(
    tree.root
      .findAllByType(Button)
      .filter((n: { props: { label: string } }) => n.props.label === 'Accept this time'),
  ).toHaveLength(51);
  expect(
    tree.root
      .findAllByType(Button)
      .filter((n: { props: { label: string } }) => n.props.label === 'Withdraw'),
  ).toHaveLength(1);
});

test('replacement account cannot receive a delayed previous-account listing', async () => {
  let finish!: (v: Value) => void;
  jest.mocked(api.getTimeSuggestions).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await render();
  jest.mocked(api.getPickCapabilities).mockResolvedValue({ availabilityFirst: false });
  await act(async () => {
    tree.update(
      <TimeSuggestions
        pickId="pick"
        viewerId="replacement"
        planAt={base().planAt}
        onChanged={changed}
      />,
    );
  });
  await act(async () => finish(base()));
  expect(button('Accept this time')).toBeUndefined();
  expect(button('Suggest another time')).toBeUndefined();
});
