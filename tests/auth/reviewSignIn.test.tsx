import React from 'react';
import SignInScreen from '../../app/sign-in';
import { auth } from '@/lib/auth';

type Node = { props: Record<string, any> };
type Tree = {
  root: {
    findAllByType(type: string): Node[];
    findAll(test: (n: Node) => boolean): Node[];
  };
  unmount(): void;
};
const { create, act } = jest.requireActual<{
  create(element: React.ReactElement): Tree;
  act(work: () => void | Promise<void>): Promise<void>;
}>('react-test-renderer');
jest.mock('expo-linear-gradient', () => ({ LinearGradient: () => null }));
let mockParams: { mode?: string } = {};
jest.mock('expo-router', () => ({ useLocalSearchParams: () => mockParams }));
jest.mock('@/lib/config', () => ({ USE_MOCK: false, REVIEW_EMAIL: 'review@example.com' }));
jest.mock('@/lib/auth', () => ({
  AuthError: class extends Error {},
  auth: { sendCode: jest.fn(), verifyCode: jest.fn(), signInWithPassword: jest.fn() },
}));
jest.mock('@/lib/mock/auth', () => ({ MOCK_CODE: '123456' }));
jest.mock('@/components/ErrorBanner', () => {
  const React = jest.requireActual('react');
  return { ErrorBanner: (props: object) => React.createElement('test-error', props) };
});
jest.mock('@/components/Button', () => {
  const React = jest.requireActual('react');
  return { Button: (props: object) => React.createElement('test-button', props) };
});
jest.mock('@/components/GradientButton', () => {
  const React = jest.requireActual('react');
  return { GradientButton: (props: object) => React.createElement('test-gradient', props) };
});

const field = (tree: Tree, label: string) =>
  tree.root.findAll((n) => n.props.accessibilityLabel === label && !!n.props.onChangeText)[0]!;
const primary = (tree: Tree) => tree.root.findAllByType('test-gradient')[0]!;
async function submitEmail(email: string) {
  let tree!: Tree;
  await act(async () => {
    tree = create(<SignInScreen />);
  });
  await act(async () => field(tree, 'Email').props.onChangeText(email));
  await act(async () => primary(tree).props.onPress());
  return tree;
}
beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
});

test('the review account asks for a password and never sends a code', async () => {
  jest.mocked(auth.signInWithPassword).mockResolvedValue({
    accessToken: 't',
    user: { id: 'u', email: 'review@example.com' },
  });
  const tree = await submitEmail(' Review@Example.com ');
  expect(auth.sendCode).not.toHaveBeenCalled();
  await act(async () => field(tree, 'Password').props.onChangeText('from-review-notes'));
  await act(async () => primary(tree).props.onPress());
  expect(auth.signInWithPassword).toHaveBeenCalledWith('review@example.com', 'from-review-notes');
  await act(async () => tree.unmount());
});

test('a wrong password shows the error and clears the field', async () => {
  jest.mocked(auth.signInWithPassword).mockRejectedValue(new Error('That password is wrong.'));
  const tree = await submitEmail('review@example.com');
  await act(async () => field(tree, 'Password').props.onChangeText('nope'));
  await act(async () => primary(tree).props.onPress());
  expect(tree.root.findAllByType('test-error')).toHaveLength(1);
  expect(field(tree, 'Password').props.value).toBe('');
  await act(async () => tree.unmount());
});

test('everyone else gets an emailed code and no password field', async () => {
  jest.mocked(auth.sendCode).mockResolvedValue();
  const tree = await submitEmail('person@example.com');
  expect(auth.sendCode).toHaveBeenCalledWith('person@example.com', 'login');
  expect(
    tree.root.findAll((n) => n.props.accessibilityLabel === 'Password' && !!n.props.onChangeText),
  ).toHaveLength(0);
  await act(async () => tree.unmount());
});

test('the intro opens sign-up or log-in, and the review password stays reachable from both', async () => {
  const texts = (tree: Tree) =>
    tree.root
      .findAll((n) => typeof n.props.children === 'string')
      .map((n) => n.props.children as string);
  for (const mode of ['signup', 'login'] as const) {
    mockParams = { mode };
    const tree = await submitEmail('review@example.com');
    expect(auth.sendCode).not.toHaveBeenCalled();
    expect(field(tree, 'Password')).toBeDefined();
    await act(async () => tree.unmount());
    const fresh = await (async () => {
      let t!: Tree;
      await act(async () => {
        t = create(<SignInScreen />);
      });
      return t;
    })();
    expect(texts(fresh)).toContain(mode === 'signup' ? 'Create your WTW account' : 'Welcome back');
    await act(async () => fresh.unmount());
  }
});

test.each(['ios', 'android'] as const)(
  'OTP has one autofill hint and a full-size accessible native field on %s',
  async (os) => {
    const { Platform, StyleSheet } = jest.requireActual('react-native');
    const previous = Platform.OS;
    Object.defineProperty(Platform, 'OS', { configurable: true, value: os });
    let tree: Tree | undefined;
    try {
      tree = await submitEmail('person@example.com');
      const input = field(tree, '6-digit code');
      expect(input.props.textContentType).toBe(os === 'ios' ? 'oneTimeCode' : undefined);
      expect(input.props.autoComplete).toBe(os === 'android' ? 'one-time-code' : undefined);
      const style = StyleSheet.flatten(input.props.style);
      expect(style.opacity).toBeUndefined();
      expect(style.width).not.toBe(1);
      expect(style.left).toBe(0);
      expect(style.right).toBe(0);
    } finally {
      if (tree) await act(async () => tree!.unmount());
      Object.defineProperty(Platform, 'OS', { configurable: true, value: previous });
    }
  },
);

test('formatted OTP paste sanitizes and auto-submits once; an invalid code can be replaced', async () => {
  let reject!: (reason: Error) => void;
  jest.mocked(auth.verifyCode).mockImplementationOnce(
    () =>
      new Promise((_, no) => {
        reject = no;
      }),
  );
  const tree = await submitEmail('person@example.com');
  await act(async () => {
    field(tree, '6-digit code').props.onChangeText('12a34 56');
    field(tree, '6-digit code').props.onChangeText('123456');
    primary(tree).props.onPress();
  });
  expect(auth.verifyCode).toHaveBeenCalledTimes(1);
  expect(auth.verifyCode).toHaveBeenCalledWith('person@example.com', '123456');
  await act(async () => reject(new Error('Invalid code')));
  expect(field(tree, '6-digit code').props.value).toBe('');
  jest
    .mocked(auth.verifyCode)
    .mockResolvedValueOnce({ accessToken: 't', user: { id: 'u', email: 'person@example.com' } });
  await act(async () => field(tree, '6-digit code').props.onChangeText('654321'));
  expect(auth.verifyCode).toHaveBeenCalledTimes(2);
  await act(async () => tree.unmount());
});
