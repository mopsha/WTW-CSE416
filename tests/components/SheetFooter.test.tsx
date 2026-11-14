import React from 'react';
import { Modal, ScrollView, Text } from 'react-native';
import { Sheet } from '@/components/TabUi';
const { act, create } = jest.requireActual('react-test-renderer');
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
test('sheet action and header action stay outside its scrolling body, and native close cancels', async () => {
  const close = jest.fn();
  let tree: any;
  await act(async () => {
    tree = create(
      <Sheet
        visible
        title="Filters"
        onClose={close}
        headerRight={<Text testID="reset">Reset</Text>}
        footer={<Text testID="apply">Show places</Text>}
      >
        <Text testID="body">Scrollable controls</Text>
      </Sheet>,
    );
  });
  const scroll = tree.root.findByType(ScrollView);
  expect(scroll.findAllByProps({ testID: 'body' }).length).toBeGreaterThan(0);
  expect(scroll.findAllByProps({ testID: 'apply' })).toHaveLength(0);
  expect(scroll.findAllByProps({ testID: 'reset' })).toHaveLength(0);
  expect(tree.root.findAllByProps({ testID: 'apply' }).length).toBeGreaterThan(0);
  await act(async () => tree.root.findByType(Modal).props.onRequestClose());
  expect(close).toHaveBeenCalledTimes(1);
  await act(async () => tree.unmount());
});
