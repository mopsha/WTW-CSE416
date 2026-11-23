import type { Birthday } from '@shared/api/birthdays.ts';
import React from 'react';
import WelcomeScreen from '../../app/welcome';
import { useProfile } from '@/hooks/useProfile';
import { api } from '@/lib/api';
import { auth } from '@/lib/auth';
import { AuthError } from '@/lib/authTypes';

type Node = {
  props: {
    label?: string;
    message?: string;
    value?: string;
    disabled?: boolean;
    accessibilityLabel?: string;
    children?: unknown;
    onPress(): void;
    onChangeText(s: string): void;
    onChange(s: Birthday): void;
  };
};
type Tree = {
  root: {
    findAllByType(type: string): Node[];
    findAllByProps(props: Record<string, unknown>): Node[];
    findAll(test: (n: Node) => boolean): Node[];
  };
  unmount(): void;
};
const { create, act } = jest.requireActual<{
  create(element: React.ReactElement): Tree;
  act(work: () => void | Promise<void>): Promise<void>;
}>('react-test-renderer');
let mockUser: { id?: string; email: string | null; provider?: string; name?: string | null } = {
  id: 'me',
  email: 'legacy@example.com',
};
jest.mock('@/hooks/useAuth', () => ({ useSession: () => ({ user: mockUser }) }));
jest.mock('@/hooks/useProfile', () => ({ useProfile: jest.fn(), suggestedName: () => 'legacy' }));
jest.mock('@/lib/auth', () => ({ auth: { signOut: jest.fn(), setPassword: jest.fn() } }));
jest.mock('@/lib/api', () => ({ api: { usernameAvailable: jest.fn() } }));
jest.mock('@/lib/haptics', () => ({ haptic: { error: jest.fn() } }));
jest.mock('@/components', () => {
  const React = jest.requireActual('react');
  return {
    ...jest.requireActual('@/components/theme'),
    Avatar: () => null,
    onboardingStyles: { input: {}, fine: {} },
    OnboardingFrame: (props: { actions: unknown; children: unknown }) =>
      React.createElement('test-frame', props, props.children, props.actions),
    Button: (props: object) => React.createElement('test-button', props),
    ErrorState: (props: object) => React.createElement('test-error', props),
  };
});
jest.mock('@/components/BirthdayField', () => ({
  BirthdayField: (props: object) =>
    jest.requireActual('react').createElement('test-birthday', props),
}));

const input = (tree: Tree, label: string) =>
  tree.root.findAllByProps({ accessibilityLabel: label }).find((n) => !!n.props.onChangeText);
const button = (tree: Tree, label: string) =>
  tree.root.findAllByType('test-button').find((b) => b.props.label === label)!;
/** Lets the 400 ms availability check run. */
const settle = () => act(async () => new Promise((r) => setTimeout(r, 450)));
async function render(profile: Record<string, unknown>) {
  jest.mocked(useProfile).mockReturnValue(profile as unknown as ReturnType<typeof useProfile>);
  let tree!: Tree;
  await act(async () => {
    tree = create(<WelcomeScreen />);
  });
  return tree;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { id: 'me', email: 'legacy@example.com' };
  jest
    .mocked(api.usernameAvailable)
    .mockImplementation(async (u: string) => ({ available: true, username: u }));
  jest.mocked(auth.setPassword).mockResolvedValue();
});

test('taken username keeps the form and drafts available for a successful retry', async () => {
  const completeIdentity = jest
    .fn()
    .mockRejectedValueOnce(new Error('That username is already taken'))
    .mockResolvedValue(undefined);
  const tree = await render({ displayName: 'Legacy', username: null, completeIdentity });
  await act(async () => input(tree, 'Password')!.props.onChangeText('long-enough'));
  await act(async () => input(tree, 'Username')!.props.onChangeText('@Taken'));
  await settle();
  await act(async () => button(tree, 'Continue').props.onPress());
  expect(tree.root.findAllByType('test-error')[0]!.props.message).toContain('already taken');
  expect(input(tree, 'Username')!.props.value).toBe('taken');
  expect(input(tree, 'Your name')!.props.value).toBe('Legacy');
  await act(async () => input(tree, 'Username')!.props.onChangeText('Available'));
  await settle();
  await act(async () => button(tree, 'Continue').props.onPress());
  expect(completeIdentity.mock.calls).toEqual([
    ['Legacy', 'taken'],
    ['Legacy', 'available'],
  ]);
  // Saved by the first try already; Supabase refuses to set the same password again.
  expect(auth.setPassword).toHaveBeenCalledTimes(1);
  await act(async () => tree.unmount());
});

test('a sign-in too old to set a password says to sign in again, not that a code was sent', async () => {
  jest
    .mocked(auth.setPassword)
    .mockRejectedValue(new AuthError('reauth_needed', 'We emailed you a code'));
  const completeIdentity = jest.fn();
  const tree = await render({ displayName: 'New', username: 'new_person', completeIdentity });
  await settle();
  await act(async () => input(tree, 'Password')!.props.onChangeText('long-enough'));
  await act(async () => button(tree, 'Continue').props.onPress());
  expect(tree.root.findAllByType('test-error')[0]!.props.message).toContain(
    'Use a different account',
  );
  expect(completeIdentity).not.toHaveBeenCalled();
  await act(async () => tree.unmount());
});

test('the username is suggested from the name until typed, and a taken one offers a fix', async () => {
  jest
    .mocked(api.usernameAvailable)
    .mockImplementation(async (u: string) =>
      u === 'alanjohn'
        ? { available: false, username: u, suggestion: 'alanjohn27' }
        : { available: true, username: u },
    );
  const tree = await render({ displayName: null, username: null, completeIdentity: jest.fn() });
  await act(async () => input(tree, 'Your name')!.props.onChangeText('Alan John'));
  expect(input(tree, 'Username')!.props.value).toBe('alanjohn');
  await settle();
  const fix = tree.root.findAll(
    (n) => n.props.accessibilityLabel === '@alanjohn is taken. Use @alanjohn27 instead',
  )[0]!;
  expect(button(tree, 'Continue').props.disabled).toBe(true);
  await act(async () => fix.props.onPress());
  expect(input(tree, 'Username')!.props.value).toBe('alanjohn27');
  // Once chosen, renaming no longer overwrites it.
  await act(async () => input(tree, 'Your name')!.props.onChangeText('Alan J'));
  expect(input(tree, 'Username')!.props.value).toBe('alanjohn27');
  await act(async () => tree.unmount());
});

test('email sign-ups need an 8+ character password, saved before the profile', async () => {
  const order: string[] = [];
  jest.mocked(auth.setPassword).mockImplementation(async () => {
    order.push('password');
  });
  const completeIdentity = jest.fn(async () => {
    order.push('profile');
  });
  const tree = await render({ displayName: 'New', username: 'new_person', completeIdentity });
  await settle();
  expect(button(tree, 'Continue').props.disabled).toBe(true);
  await act(async () => input(tree, 'Password')!.props.onChangeText('short'));
  expect(button(tree, 'Continue').props.disabled).toBe(true);
  await act(async () => input(tree, 'Password')!.props.onChangeText('long-enough'));
  await act(async () => button(tree, 'Continue').props.onPress());
  expect(auth.setPassword).toHaveBeenCalledWith('long-enough', { userId: 'me' });
  expect(order).toEqual(['password', 'profile']);
  await act(async () => tree.unmount());
});

test('Apple and Google accounts skip the password and start from their name', async () => {
  mockUser = { email: 'x@privaterelay.appleid.com', provider: 'apple', name: 'Sam Lee' };
  const completeIdentity = jest.fn();
  const tree = await render({ displayName: null, username: null, completeIdentity });
  expect(input(tree, 'Password')).toBeUndefined();
  expect(input(tree, 'Your name')!.props.value).toBe('Sam Lee');
  expect(input(tree, 'Username')!.props.value).toBe('samlee');
  await settle();
  await act(async () => button(tree, 'Continue').props.onPress());
  expect(auth.setPassword).not.toHaveBeenCalled();
  expect(completeIdentity).toHaveBeenCalledWith('Sam Lee', 'samlee');
  await act(async () => tree.unmount());
});

test('new-account setup accepts an optional birthday and Skip discards an invalid draft', async () => {
  mockUser = { email: 'new@example.com', provider: 'google', name: null };
  const completeIdentity = jest.fn();
  const tree = await render({
    displayName: 'New',
    username: 'new_person',
    birthdayRequired: true,
    completeIdentity,
  });
  await settle();
  const save = () => button(tree, 'Continue').props.onPress();
  expect(tree.root.findAllByType('test-birthday')[0]!.props.value).toBeNull();
  await act(async () => save());
  expect(completeIdentity).toHaveBeenCalledWith('New', 'new_person');
  completeIdentity.mockClear();
  await act(async () =>
    tree.root.findAllByType('test-birthday')[0]!.props.onChange({ month: 2, day: 30 }),
  );
  await act(async () => save());
  expect(completeIdentity).not.toHaveBeenCalled();
  await act(async () =>
    tree.root.findAllByType('test-birthday')[0]!.props.onChange({ month: 2, day: 29 }),
  );
  await act(async () => save());
  expect(completeIdentity).toHaveBeenCalledWith('New', 'new_person', { month: 2, day: 29 });
  await act(async () =>
    tree.root.findAllByType('test-birthday')[0]!.props.onChange({ month: 2, day: 30 }),
  );
  await act(async () => button(tree, 'Skip birthday').props.onPress());
  expect(completeIdentity).toHaveBeenLastCalledWith('New', 'new_person', null);
  await act(async () => tree.unmount());
});
