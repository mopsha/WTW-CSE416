import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { PickTopBar, Pill } from '@/components/PickParts';
import { SectionHeading } from '@/components/TabUi';
import { fonts, numeric } from '@/components/theme';
const { act, create } = jest.requireActual('react-test-renderer');
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-router', () => ({ router: {} }));
jest.mock('@/components/Avatar', () => ({ Avatar: () => null }));
const style = (node: any) => StyleSheet.flatten(node.props.style);

test('ordinary subtitles and pills retain named Poppins faces without numeric weights', async () => {
  let tree: any;
  await act(async () => {
    tree = create(
      <>
        <PickTopBar title="Pick" subtitle="Lobby · waiting to start" />
        <Pill text="Members 12" />
      </>,
    );
  });
  const texts = tree.root.findAllByType(Text);
  const subtitle = texts.find((n: any) => n.props.children === 'Lobby · waiting to start');
  const pill = texts.find((n: any) => n.props.children === 'Members 12');
  expect(style(subtitle).fontFamily).toBe(fonts.medium);
  expect(style(pill).fontFamily).toBe(fonts.semibold);
  for (const n of [subtitle, pill]) {
    expect(style(n).fontVariant).toBeUndefined();
    expect(style(n).fontWeight).toBeUndefined();
  }
  await act(async () => tree.unmount());
});

test.each(['1:15 left', '2h 05m left', '1d 2h left'])(
  'only countdown digits use a tabular native font: %s',
  async (label) => {
    let tree: any;
    await act(async () => {
      tree = create(
        <PickTopBar title="Pick" subtitle={`2 of 3 voted · ${label}`} tabularCountdown />,
      );
    });
    const native = tree.root
      .findAllByType(Text)
      .filter((n: any) => style(n)?.fontFamily === numeric.fontFamily);
    expect(native.length).toBeGreaterThan(0);
    for (const n of native) {
      expect(n.props.children).toMatch(/^\d+(?::\d{2})?$/);
      expect(style(n).fontVariant).toEqual(['tabular-nums']);
    }
    expect(JSON.stringify(tree.toJSON())).toContain('2 of 3 voted · ');
    await act(async () => tree.unmount());
  },
);

test('static badges keep Poppins semibold without an overridden numeric font or synthetic weight', async () => {
  let tree: any;
  await act(async () => {
    tree = create(<SectionHeading title="Friends" badge={12} />);
  });
  const badge = tree.root.findAllByType(Text).find((n: any) => n.props.children === 12);
  expect(style(badge).fontFamily).toBe(fonts.semibold);
  expect(style(badge).fontVariant).toBeUndefined();
  expect(style(badge).fontWeight).toBeUndefined();
  await act(async () => tree.unmount());
});

test('countdown Pill keeps Poppins copy and semibold hierarchy around native digits', async () => {
  let tree: any;
  await act(async () => {
    tree = create(<Pill text="Closes in 1:15" tabularCountdown />);
  });
  const texts = tree.root.findAllByType(Text);
  const parent = texts.find((n: any) => style(n)?.fontFamily === fonts.semibold);
  expect(parent).toBeDefined();
  expect(style(parent).fontWeight).toBeUndefined();
  const digits = texts.find((n: any) => n.props.children === '1:15');
  expect(style(digits).fontFamily).toBe(numeric.fontFamily);
  expect(style(digits).fontWeight).toBe('600');
  await act(async () => tree.unmount());
});
