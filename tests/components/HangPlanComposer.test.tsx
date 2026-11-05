import React from 'react';
import { Keyboard, Platform, TextInput } from 'react-native';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { HangPlanComposer } from '@/components/HangPlanComposer';
import { api } from '@/lib/api';
import { queries } from '@/lib/queries';
import { parseHang } from '@shared/api/hang.ts';

let mockReduceMotion = false;
jest.mock('react-native-reanimated', () => ({ useReducedMotion: () => mockReduceMotion }));
const { act, create } = jest.requireActual('react-test-renderer');
jest.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ session: { user: { id: 'me' } } }) }));
jest.mock('@/lib/api', () => ({ api: { createHang: jest.fn() } }));
jest.mock('@/lib/queries', () => ({ queries: { listMyGroups: jest.fn() } }));
jest.mock('@react-native-community/datetimepicker', () => ({
  __esModule: true,
  default: (props: object) => jest.requireActual('react').createElement('native-picker', props),
  DateTimePickerAndroid: { open: jest.fn(), dismiss: jest.fn().mockResolvedValue(true) },
}));
jest.mock('@/components/index', () => ({
  Screen: ({ children }: { children: React.ReactNode }) => children,
  Button: (props: object) => jest.requireActual('react').createElement('kit-button', props),
  ErrorState: (props: object) => jest.requireActual('react').createElement('kit-error', props),
  IconButton: (props: object) => jest.requireActual('react').createElement('kit-icon', props),
}));
jest.mock('@/components/TabUi', () => ({
  Sheet: ({
    visible,
    children,
    ...props
  }: {
    visible: boolean;
    children: React.ReactNode;
    animationType: string;
  }) =>
    visible ? jest.requireActual('react').createElement('selection-sheet', props, children) : null,
}));
type Node = { props: Record<string, any> };
type Tree = {
  root: { findAllByType(type: unknown): Node[]; findAllByProps(props: object): Node[] };
  unmount(): void;
};
let tree: Tree;
const onCreated = jest.fn();
const onClose = jest.fn();
const groupId = 'a0000001-2222-4222-8222-222222222222';
const originalOS = Platform.OS;
beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 0, 15, 12));
  jest.clearAllMocks();
  mockReduceMotion = false;
  Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
  jest
    .mocked(queries.listMyGroups)
    .mockResolvedValue([
      { id: groupId, name: 'Weekend friends', ownerId: 'me', isOwner: true, memberCount: 4 },
    ]);
  jest.mocked(api.createHang).mockResolvedValue({} as never);
});
afterEach(async () => {
  await act(async () => tree?.unmount());
  Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
  jest.restoreAllMocks();
  jest.useRealTimers();
});
async function mount() {
  await act(async () => {
    tree = create(<HangPlanComposer onClose={onClose} onCreated={onCreated} />);
  });
}
function node(label: string) {
  return tree.root
    .findAllByProps({ accessibilityLabel: label })
    .find((n) => typeof n.props.onPress === 'function')!;
}
async function press(label: string) {
  await act(async () => node(label).props.onPress());
}
function save() {
  return tree.root.findAllByType('kit-button').find((n) => n.props.label === 'Save hang plan')!;
}
async function choose(activity: string, current = 'Choose an activity') {
  await press(`Activity, ${current}`);
  await press(activity);
}
const picker = () => tree.root.findAllByType('native-picker')[0]!;
async function openDate() {
  const row = tree.root
    .findAllByProps({ accessibilityRole: 'button' })
    .find((n) => String(n.props.accessibilityLabel).startsWith('Date,') && n.props.onPress)!;
  await act(async () => row.props.onPress());
}
async function openTime() {
  const row = tree.root
    .findAllByProps({ accessibilityRole: 'button' })
    .find((n) => String(n.props.accessibilityLabel).startsWith('Time,') && n.props.onPress)!;
  await act(async () => row.props.onPress());
}

test('suggested activity and default schedule preserve the backend contract and success callback', async () => {
  await mount();
  expect(save().props.disabled).toBe(true);
  await choose('Game night');
  expect(save().props.disabled).toBe(false);
  await act(async () => save().props.onPress());
  const input = jest.mocked(api.createHang).mock.calls[0]![0];
  expect(input).toEqual({
    activity: 'Game night',
    audience: 'all_friends',
    groupId: null,
    startsAt: new Date(2026, 0, 15, 13).toISOString(),
    expiresAt: new Date(2026, 0, 15, 17).toISOString(),
  });
  expect(parseHang(input)).toEqual(input);
  expect(onCreated).toHaveBeenCalledTimes(1);
});
test('Other keeps custom text when switching suggestions and back', async () => {
  await mount();
  await choose('Other');
  await act(async () =>
    tree.root.findAllByType(TextInput)[0]!.props.onChangeText('  Board games  '),
  );
  await choose('Basketball', 'Other');
  expect(tree.root.findAllByType(TextInput)).toHaveLength(0);
  await choose('Other', 'Basketball');
  expect(tree.root.findAllByType(TextInput)[0]!.props.value).toBe('  Board games  ');
  await act(async () => save().props.onPress());
  expect(api.createHang).toHaveBeenCalledWith(expect.objectContaining({ activity: 'Board games' }));
});
test.each(['', '   ', 'x'.repeat(61)])(
  'invalid custom activity is rejected before sending: %j',
  async (text) => {
    await mount();
    await choose('Other');
    await act(async () => tree.root.findAllByType(TextInput)[0]!.props.onChangeText(text));
    expect(save().props.disabled).toBe(true);
    await act(async () => save().props.onPress());
    expect(api.createHang).not.toHaveBeenCalled();
    expect(tree.root.findAllByType('kit-error')[0]!.props.message).toBe(
      'Enter an activity with 1–60 characters.',
    );
  },
);
test('iOS uses real spinner props, dismisses keyboard, and preserves date/time parts across midnight', async () => {
  const dismiss = jest.spyOn(Keyboard, 'dismiss');
  await mount();
  await choose('Movie night');
  await openDate();
  expect(picker().props).toMatchObject({ display: 'spinner', mode: 'date', themeVariant: 'dark' });
  await act(async () => picker().props.onValueChange({}, new Date(2026, 0, 16)));
  await openTime();
  expect(picker().props.mode).toBe('time');
  await act(async () => picker().props.onValueChange({}, new Date(2026, 0, 15, 0, 15)));
  await press('Done choosing date and time');
  expect(tree.root.findAllByType('native-picker')).toHaveLength(0);
  await act(async () => save().props.onPress());
  expect(api.createHang).toHaveBeenCalledWith(
    expect.objectContaining({
      startsAt: new Date(2026, 0, 16, 0, 15).toISOString(),
      expiresAt: new Date(2026, 0, 16, 4, 15).toISOString(),
    }),
  );
  expect(dismiss).toHaveBeenCalled();
});
test.each([new Date(2026, 0, 14, 13), new Date(2026, 0, 23, 13)])(
  'past or out-of-horizon selection is rejected: %s',
  async (date) => {
    await mount();
    await choose('Cookout');
    await openDate();
    await act(async () => picker().props.onValueChange({}, date));
    expect(save().props.disabled).toBe(true);
    await act(async () => save().props.onPress());
    expect(api.createHang).not.toHaveBeenCalled();
  },
);
test('a stale open form rechecks time at submission', async () => {
  await mount();
  await choose('Study session');
  jest.setSystemTime(new Date(2026, 0, 15, 14));
  await act(async () => save().props.onPress());
  expect(api.createHang).not.toHaveBeenCalled();
  expect(tree.root.findAllByType('kit-error')[0]!.props.message).toBe(
    'Choose a future date and time.',
  );
});
test('audience selection preserves group IDs and existing payload semantics', async () => {
  await mount();
  await choose('House party');
  await press('Audience, All friends');
  await press('Weekend friends');
  await act(async () => save().props.onPress());
  expect(api.createHang).toHaveBeenCalledWith(
    expect.objectContaining({ audience: 'group', groupId }),
  );
});
test('duplicate taps are blocked while sending and an API failure preserves selections for retry', async () => {
  let fail!: (e: Error) => void;
  jest.mocked(api.createHang).mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        fail = reject;
      }),
  );
  await mount();
  await choose('Basketball');
  await act(async () => {
    save().props.onPress();
    save().props.onPress();
  });
  expect(api.createHang).toHaveBeenCalledTimes(1);
  expect(save().props.loading).toBe(true);
  await act(async () => fail(new Error('Offline. Try again.')));
  expect(onCreated).not.toHaveBeenCalled();
  expect(tree.root.findAllByType('kit-error')[0]!.props.message).toBe('Offline. Try again.');
  expect(node('Activity, Basketball')).toBeDefined();
  await act(async () => save().props.onPress());
  expect(api.createHang).toHaveBeenCalledTimes(2);
  expect(onCreated).toHaveBeenCalledTimes(1);
});
test('group load failure is retryable and does not prevent sharing with friends', async () => {
  jest.mocked(queries.listMyGroups).mockRejectedValueOnce(new Error('No network'));
  await mount();
  await choose('Game night');
  expect(save().props.disabled).toBe(false);
  const error = tree.root.findAllByType('kit-error')[0]!;
  expect(error.props.message).toBe('Could not load groups: No network');
  await act(async () => error.props.onRetry());
  await press('Audience, All friends');
  expect(node('Weekend friends')).toBeDefined();
});
test('Android opens native dialogs, cancellation retains values and time updates preserve the date', async () => {
  Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
  await mount();
  await choose('Game night');
  await openDate();
  const date = jest.mocked(DateTimePickerAndroid.open).mock.calls[0]![0];
  expect(date).toMatchObject({ mode: 'date', display: 'default' });
  await act(async () => date.onDismiss?.());
  await openTime();
  const time = jest.mocked(DateTimePickerAndroid.open).mock.calls[1]![0];
  expect(time.minimumDate).toBeUndefined(); // Android time dialogs do not enforce date bounds.
  await act(async () =>
    time.onValueChange?.(
      { nativeEvent: { timestamp: 0, utcOffset: 0 } },
      new Date(2026, 0, 15, 18, 30),
    ),
  );
  await act(async () => save().props.onPress());
  expect(api.createHang).toHaveBeenCalledWith(
    expect.objectContaining({ startsAt: new Date(2026, 0, 15, 18, 30).toISOString() }),
  );
  expect(tree.root.findAllByType('native-picker')).toHaveLength(0);
});

test('selection sheets respect the existing reduced-motion setting', async () => {
  mockReduceMotion = true;
  await mount();
  await press('Activity, Choose an activity');
  expect(tree.root.findAllByType('selection-sheet')[0]!.props.animationType).toBe('none');
});
