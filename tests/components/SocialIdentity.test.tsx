import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { SocialIdentity } from '@/components/friends/SocialRow';
const { create, act } = jest.requireActual('react-test-renderer');
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

test('friends, header and message sizes retain the same normalized-name identity color', async () => {
  const colors: string[] = [];
  for (const [name, size] of [
    ['Ava', 60],
    [' ava ', 40],
    ['AVA', 28],
  ] as const) {
    let tree: any;
    await act(async () => {
      tree = create(<SocialIdentity name={name} size={size} />);
    });
    const avatar = tree.root
      .findAllByType(View)
      .find((n: any) => n.props.accessibilityRole === 'image');
    const style = StyleSheet.flatten(avatar.props.style);
    expect(style.width).toBe(size);
    expect(style.height).toBe(size);
    colors.push(style.backgroundColor);
    expect(tree.root.findByType(Text).props.children).toBe('A');
    await act(async () => tree.unmount());
  }
  expect(new Set(colors).size).toBe(1);
});

test('actual profile images remain visible at every social avatar size', async () => {
  for (const size of [60, 40, 28]) {
    let tree: any;
    await act(async () => {
      tree = create(<SocialIdentity name="Ava" size={size} uri="https://example.test/ava.jpg" />);
    });
    expect(tree.root.findByType(Image).props.source).toEqual({
      uri: 'https://example.test/ava.jpg',
    });
    expect(tree.root.findAllByType(Text)).toHaveLength(0);
    await act(async () => tree.unmount());
  }
});
