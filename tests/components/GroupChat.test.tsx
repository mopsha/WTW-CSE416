import React from 'react';
import { GroupChat } from '@/components/GroupChat';
import { useGroupChat } from '@/hooks/useGroupChat';
import { api } from '@/lib/api';
type Node = {
  props: { label?: string; value?: string; onPress(): void; onChangeText(s: string): void };
};
type Tree = {
  root: { findAllByType(type: string): Node[]; findAllByProps(props: object): Node[] };
  unmount(): void;
};
const { create, act } = jest.requireActual<{
  create(element: React.ReactElement): Tree;
  act(work: () => void | Promise<void>): Promise<void>;
}>('react-test-renderer');
jest.mock('@/hooks/useGroupChat', () => ({ useGroupChat: jest.fn() }));
jest.mock('@/lib/api', () => ({ api: { sendGroupMessage: jest.fn() } }));
jest.mock('@/components', () => {
  const React = jest.requireActual('react');
  return {
    ...jest.requireActual('@/components/theme'),
    Card: ({ children }: { children: React.ReactNode }) => children,
    Avatar: () => null,
    ErrorState: () => null,
    Button: (props: object) => React.createElement('test-button', props),
  };
});
test('failed send retains the draft and retry ID, duplicate taps are ignored, success clears the draft', async () => {
  const refresh = jest.fn().mockResolvedValue(undefined);
  jest.mocked(useGroupChat).mockReturnValue({
    messages: [],
    loading: false,
    error: null,
    unavailable: false,
    mode: 'polling',
    refresh,
  });
  let reject!: (error: Error) => void;
  jest.mocked(api.sendGroupMessage).mockReturnValueOnce(
    new Promise((_resolve, r) => {
      reject = r;
    }),
  );
  let tree!: Tree;
  await act(async () => {
    tree = create(<GroupChat groupId="group-1" userId="me" />);
  });
  expect(tree.root.findAllByProps({ reportKind: 'group_message' }).length).toBeGreaterThan(0);
  await act(async () =>
    tree.root
      .findAllByProps({ accessibilityLabel: 'Group message' })[0]!
      .props.onChangeText(' Hello '),
  );
  await act(async () => {
    const button = tree.root.findAllByType('test-button')[0]!;
    button.props.onPress();
    button.props.onPress();
  });
  expect(api.sendGroupMessage).toHaveBeenCalledTimes(1);
  const first = jest.mocked(api.sendGroupMessage).mock.calls[0]![1];
  await act(async () => reject(new Error('Offline')));
  expect(tree.root.findAllByProps({ accessibilityLabel: 'Group message' })[0]!.props.value).toBe(
    ' Hello ',
  );
  jest
    .mocked(api.sendGroupMessage)
    .mockResolvedValue({} as Awaited<ReturnType<typeof api.sendGroupMessage>>);
  await act(async () => tree.root.findAllByType('test-button')[0]!.props.onPress());
  expect(api.sendGroupMessage).toHaveBeenNthCalledWith(2, 'group-1', first);
  expect(first.body).toBe('Hello');
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(tree.root.findAllByProps({ accessibilityLabel: 'Group message' })[0]!.props.value).toBe(
    '',
  );
  await act(async () => tree.unmount());
});

test('route-owned composer survives remount, retains retry ID and clears after successful delivery', async () => {
  const { emptyMessageDraft } = jest.requireActual('@/components/MessageThread');
  const composerRef = emptyMessageDraft();
  jest.mocked(api.sendGroupMessage).mockReset().mockRejectedValueOnce(new Error('Offline'));
  const refresh = jest.fn().mockResolvedValue(undefined);
  jest.mocked(useGroupChat).mockReturnValue({
    messages: [],
    loading: false,
    error: null,
    unavailable: false,
    mode: 'polling',
    refresh,
  });
  let tree!: Tree;
  const mount = async () => {
    await act(async () => {
      tree = create(<GroupChat groupId="group-1" userId="me" composerRef={composerRef} />);
    });
  };
  const input = () => tree.root.findAllByProps({ accessibilityLabel: 'Group message' })[0]!;
  const send = () => tree.root.findAllByType('test-button')[0]!.props.onPress();
  await mount();
  await act(async () => input().props.onChangeText('Keep me'));
  await act(async () => send());
  const first = jest.mocked(api.sendGroupMessage).mock.calls[0]![1];
  await act(async () => tree.unmount());
  await mount();
  expect(input().props.value).toBe('Keep me');
  let finish!: (value: any) => void;
  jest.mocked(api.sendGroupMessage).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await act(async () => send());
  expect(api.sendGroupMessage).toHaveBeenLastCalledWith('group-1', first);
  await act(async () => tree.unmount());
  await mount();
  await act(async () => send());
  expect(api.sendGroupMessage).toHaveBeenCalledTimes(2);
  await act(async () => finish({ status: 'ok' }));
  expect(input().props.value).toBe('');
  expect(composerRef.current.body).toBe('');
  expect(composerRef.current.attempt).toBeNull();
  await act(async () => tree.unmount());
});

test('confirmed chat access loss erases the route-owned draft and retry attempt', async () => {
  const { emptyMessageDraft } = jest.requireActual('@/components/MessageThread');
  const composerRef = emptyMessageDraft();
  composerRef.current.body = 'Private';
  composerRef.current.attempt = { body: 'Private', clientId: 'old-attempt' };
  jest.mocked(useGroupChat).mockReturnValue({
    messages: [],
    loading: false,
    error: null,
    unavailable: true,
    mode: 'polling',
    refresh: jest.fn().mockResolvedValue(undefined),
  });
  let tree!: Tree;
  await act(async () => {
    tree = create(<GroupChat groupId="group-1" userId="me" composerRef={composerRef} />);
  });
  expect(composerRef.current.body).toBe('');
  expect(composerRef.current.attempt).toBeNull();
  expect(tree.root.findAllByProps({ accessibilityLabel: 'Group message' })[0]!.props.value).toBe(
    '',
  );
  await act(async () => tree.unmount());
});
