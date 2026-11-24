import { ContactInvite } from '@/components/friends/ContactInvite';
import { Button } from '@/components';
import { createContactRequest, shareInvite } from '@/lib/contactInvites';
import { Text } from 'react-native';

const { create, act } = jest.requireActual('react-test-renderer');
jest.mock('@/hooks/useProfile', () => ({ useProfile: () => ({ username: 'alex' }) }));
jest.mock('@/lib/contactInvites', () => ({
  contactPickerAvailable: true,
  nativeSharing: true,
  contactInvitation: () => ({ message: 'Invite preview', installedOnly: true }),
  createContactRequest: jest.fn(),
  shareInvite: jest.fn(),
}));
jest.mock('@/components', () => ({
  Button: () => null,
  Card: ({ children }: { children: React.ReactNode }) => children,
  ErrorState: ({ message }: { message: string }) => message,
  colors: {},
  space: {},
  type: {},
}));

let tree: ReturnType<typeof create>;
beforeEach(() => jest.resetAllMocks());
afterEach(async () => {
  await act(async () => tree.unmount());
});

test('renders empty-picker guidance and keeps manual search one tap away', async () => {
  const back = jest.fn();
  await act(async () => {
    tree = create(<ContactInvite onBack={back} />);
  });
  expect(
    tree.root
      .findAllByType(Text)
      .some(
        ({ props }: { props: { children?: unknown } }) =>
          typeof props.children === 'string' && props.children.includes('picker is empty'),
      ),
  ).toBe(true);
  expect(tree.root.findAllByType(Button)[1].props.label).toBe('Share with a WTW user');
  expect(
    tree.root
      .findAllByType(Text)
      .some(
        ({ props }: { props: { children?: unknown } }) =>
          typeof props.children === 'string' && props.children.includes('no install link'),
      ),
  ).toBe(true);
  expect(createContactRequest).not.toHaveBeenCalled();
  expect(shareInvite).not.toHaveBeenCalled();
  tree.root.findByType(ContactInvite).findAllByType(Button).at(-1)?.props.onPress();
  expect(back).toHaveBeenCalledTimes(1);
});

test('duplicate taps open one picker and replacing the account invalidates its selection', async () => {
  let finish!: () => void;
  const run = jest.fn(
    () => new Promise<undefined>((resolve) => (finish = () => resolve(undefined))),
  );
  const cancel = jest.fn();
  jest.mocked(createContactRequest).mockReturnValue({ run, cancel });
  await act(async () => {
    tree = create(<ContactInvite key="first-account" onBack={jest.fn()} />);
  });
  const pick = tree.root.findAllByType(Button)[0].props.onPress;
  await act(async () => {
    pick();
    pick();
  });
  expect(createContactRequest).toHaveBeenCalledTimes(1);
  expect(run).toHaveBeenCalledTimes(1);
  expect(cancel).not.toHaveBeenCalled();
  await act(async () => {
    tree.update(<ContactInvite key="second-account" onBack={jest.fn()} />);
  });
  expect(cancel).toHaveBeenCalledTimes(1);
  await act(async () => finish());
  expect(shareInvite).not.toHaveBeenCalled();
});

test('an unavailable messaging app leaves the invite available to share explicitly', async () => {
  const run = jest.fn().mockResolvedValue('textUnavailable');
  jest.mocked(createContactRequest).mockReturnValue({ run, cancel: jest.fn() });
  await act(async () => {
    tree = create(<ContactInvite onBack={jest.fn()} />);
  });
  const [pick, share] = tree.root.findAllByType(Button);
  await act(async () => pick.props.onPress());
  expect(JSON.stringify(tree.toJSON())).toContain('Text messaging is unavailable');
  expect(shareInvite).not.toHaveBeenCalled();
  jest.mocked(shareInvite).mockResolvedValue(true);
  await act(async () => share.props.onPress());
  expect(shareInvite).toHaveBeenCalledWith('Invite preview');
});
