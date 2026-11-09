import type { Birthday } from '@shared/api/birthdays.ts';
import React from 'react';
import WelcomeScreen from '../../app/welcome';
import { useProfile } from '@/hooks/useProfile';

type Node = {
  props: {
    label?: string;
    message?: string;
    value?: string;
    onPress(): void;
    onChangeText(s: string): void;
    onChange(s: Birthday): void;
  };
};
type Tree = {
  root: {
    findAllByType(type: string): Node[];
    findAllByProps(props: Record<string, unknown>): Node[];
  };
  unmount(): void;
};
const { create, act } = jest.requireActual<{
  create(element: React.ReactElement): Tree;
  act(work: () => void | Promise<void>): Promise<void>;
}>('react-test-renderer');
jest.mock('@/hooks/useAuth', () => ({
  useSession: () => ({ user: { email: 'legacy@example.com' } }),
}));
jest.mock('@/hooks/useProfile', () => ({ useProfile: jest.fn(), suggestedName: () => 'legacy' }));
jest.mock('@/lib/auth', () => ({ auth: { signOut: jest.fn() } }));
jest.mock('@/lib/haptics', () => ({ haptic: { error: jest.fn() } }));
jest.mock('@/components', () => {
  const React = jest.requireActual('react');
  return {
    ...jest.requireActual('@/components/theme'),
    Avatar: () => null,
    Button: (props: object) => React.createElement('test-button', props),
    ErrorState: (props: object) => React.createElement('test-error', props),
  };
});
jest.mock('@/components/BirthdayField', () => ({
  BirthdayField: (props: object) =>
    jest.requireActual('react').createElement('test-birthday', props),
}));
jest.mock('@/components/GradientButton', () => ({
  GradientButton: (props: object) =>
    jest.requireActual('react').createElement('test-button', props),
}));
test('taken username keeps the form and drafts available for a successful retry', async () => {
  const completeIdentity = jest
    .fn()
    .mockRejectedValueOnce(new Error('That username is already taken'))
    .mockResolvedValue(undefined);
  jest.mocked(useProfile).mockReturnValue({
    displayName: 'Legacy',
    username: null,
    completeIdentity,
    failed: false,
  } as unknown as ReturnType<typeof useProfile>);
  let tree!: Tree;
  await act(async () => {
    tree = create(<WelcomeScreen />);
  });
  async function typeUsername(value: string) {
    await act(async () => {
      tree.root.findAllByProps({ accessibilityLabel: 'Username' })[0]!.props.onChangeText(value);
    });
  }
  async function save() {
    await act(async () => {
      tree.root
        .findAllByType('test-button')
        .find((b) => b.props.label === 'Save')!
        .props.onPress();
    });
  }
  await typeUsername('@Taken');
  await save();
  expect(tree.root.findAllByType('test-error')[0]!.props.message).toContain('already taken');
  expect(tree.root.findAllByProps({ accessibilityLabel: 'Username' })[0]!.props.value).toBe(
    '@Taken',
  );
  expect(tree.root.findAllByProps({ accessibilityLabel: 'Your name' })[0]!.props.value).toBe(
    'Legacy',
  );
  await typeUsername('@Available');
  await save();
  expect(completeIdentity.mock.calls).toEqual([
    ['Legacy', 'taken'],
    ['Legacy', 'available'],
  ]);
  await act(async () => tree.unmount());
});

test('new-account setup accepts an optional birthday and Skip discards an invalid draft', async () => {
  const completeIdentity = jest.fn();
  jest.mocked(useProfile).mockReturnValue({
    displayName: 'New',
    username: 'new_person',
    birthdayRequired: true,
    completeIdentity,
  } as unknown as ReturnType<typeof useProfile>);
  let tree!: Tree;
  await act(async () => {
    tree = create(<WelcomeScreen />);
  });
  const save = () =>
    tree.root
      .findAllByType('test-button')
      .find((n) => n.props.label === 'Save')!
      .props.onPress();
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
  await act(async () =>
    tree.root
      .findAllByType('test-button')
      .find((n) => n.props.label === 'Skip birthday')!
      .props.onPress(),
  );
  expect(completeIdentity).toHaveBeenLastCalledWith('New', 'new_person', null);
  await act(async () => tree.unmount());
});
