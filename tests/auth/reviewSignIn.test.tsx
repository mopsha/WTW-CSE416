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
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
let mockParams: { mode?: string } = {};
jest.mock('expo-router', () => ({ useLocalSearchParams: () => mockParams }));
jest.mock('@/lib/config', () => ({ USE_MOCK: false }));
let mockApple = false;
let mockGoogle = false;
jest.mock('@/lib/socialSignIn', () => ({
  appleSignInAvailable: async () => mockApple,
  googleSignInAvailable: () => mockGoogle,
}));
jest.mock('@/lib/auth', () => ({
  AuthError: class extends Error {},
  auth: {
    sendCode: jest.fn(),
    verifyCode: jest.fn(),
    signInWithPassword: jest.fn(),
    signInWithApple: jest.fn(),
    signInWithGoogle: jest.fn(),
  },
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
  tree.root.findAll((n) => n.props.accessibilityLabel === label && !!n.props.onChangeText)[0];
const pressable = (tree: Tree, label: string) =>
  tree.root.findAll(
    (n) => (n.props.label === label || n.props.accessibilityLabel === label) && !!n.props.onPress,
  )[0];
const primary = (tree: Tree) => tree.root.findAllByType('test-gradient')[0]!;
async function render() {
  let tree!: Tree;
  await act(async () => {
    tree = create(<SignInScreen />);
  });
  return tree;
}
/** Sign up with an email: the code is sent and the code boxes open. */
async function signUp(email: string) {
  mockParams = { mode: 'signup' };
  const tree = await render();
  await act(async () => field(tree, 'Email')!.props.onChangeText(email));
  await act(async () => primary(tree).props.onPress());
  return tree;
}
beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  mockApple = false;
  mockGoogle = false;
});

test('log in with a username (or the review email) and password', async () => {
  jest.mocked(auth.signInWithPassword).mockResolvedValue({
    accessToken: 't',
    user: { id: 'u', email: null },
  });
  const tree = await render();
  await act(async () => field(tree, 'Username or email')!.props.onChangeText('alan'));
  await act(async () => field(tree, 'Password')!.props.onChangeText('hunter22'));
  await act(async () => primary(tree).props.onPress());
  expect(auth.signInWithPassword).toHaveBeenCalledWith('alan', 'hunter22');
  expect(auth.sendCode).not.toHaveBeenCalled();
  await act(async () => tree.unmount());
});

test('a wrong password shows the error and clears the field', async () => {
  jest.mocked(auth.signInWithPassword).mockRejectedValue(new Error('Wrong username or password.'));
  const tree = await render();
  await act(async () => field(tree, 'Username or email')!.props.onChangeText('alan'));
  await act(async () => field(tree, 'Password')!.props.onChangeText('nope'));
  await act(async () => primary(tree).props.onPress());
  expect(tree.root.findAllByType('test-error')).toHaveLength(1);
  expect(field(tree, 'Password')!.props.value).toBe('');
  await act(async () => tree.unmount());
});

test('a forgotten password falls back to an emailed login code', async () => {
  jest.mocked(auth.sendCode).mockResolvedValue();
  const tree = await render();
  await act(async () => field(tree, 'Username or email')!.props.onChangeText('person@example.com'));
  await act(async () => pressable(tree, 'Forgot password? Email me a code')!.props.onPress());
  expect(field(tree, 'Email')!.props.value).toBe('person@example.com');
  await act(async () => primary(tree).props.onPress());
  expect(auth.sendCode).toHaveBeenCalledWith('person@example.com', 'login');
  await act(async () => tree.unmount());
});

test('sign up emails a code first; the password comes on the welcome screen', async () => {
  jest.mocked(auth.sendCode).mockResolvedValue();
  const tree = await signUp('New@Example.com ');
  expect(auth.sendCode).toHaveBeenCalledWith('new@example.com', 'signup');
  expect(field(tree, 'Password')).toBeUndefined();
  expect(field(tree, '6-digit code')).toBeDefined();
  await act(async () => tree.unmount());
});

test('Apple and Google appear only when set up, and a cancel is silent', async () => {
  const none = await render();
  expect(pressable(none, 'Continue with Apple')).toBeUndefined();
  expect(pressable(none, 'Continue with Google')).toBeUndefined();
  await act(async () => none.unmount());

  mockApple = true;
  mockGoogle = true;
  jest.mocked(auth.signInWithApple).mockResolvedValue(null); // canceled
  const tree = await render();
  await act(async () => pressable(tree, 'Continue with Apple')!.props.onPress());
  expect(auth.signInWithApple).toHaveBeenCalledTimes(1);
  expect(tree.root.findAllByType('test-error')).toHaveLength(0);
  jest.mocked(auth.signInWithGoogle).mockRejectedValue(new Error('Google is unavailable'));
  await act(async () => pressable(tree, 'Continue with Google')!.props.onPress());
  expect(tree.root.findAllByType('test-error')).toHaveLength(1);
  await act(async () => tree.unmount());
});

test.each(['ios', 'android'] as const)(
  'OTP has one autofill hint and a full-size accessible native field on %s',
  async (os) => {
    const { Platform, StyleSheet } = jest.requireActual('react-native');
    const previous = Platform.OS;
    Object.defineProperty(Platform, 'OS', { configurable: true, value: os });
    let tree: Tree | undefined;
    try {
      tree = await signUp('person@example.com');
      const input = field(tree, '6-digit code')!;
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
  const tree = await signUp('person@example.com');
  await act(async () => {
    field(tree, '6-digit code')!.props.onChangeText('12a34 56');
    field(tree, '6-digit code')!.props.onChangeText('123456');
    primary(tree).props.onPress();
  });
  expect(auth.verifyCode).toHaveBeenCalledTimes(1);
  expect(auth.verifyCode).toHaveBeenCalledWith('person@example.com', '123456');
  await act(async () => reject(new Error('Invalid code')));
  expect(field(tree, '6-digit code')!.props.value).toBe('');
  jest
    .mocked(auth.verifyCode)
    .mockResolvedValueOnce({ accessToken: 't', user: { id: 'u', email: 'person@example.com' } });
  await act(async () => field(tree, '6-digit code')!.props.onChangeText('654321'));
  expect(auth.verifyCode).toHaveBeenCalledTimes(2);
  await act(async () => tree.unmount());
});
