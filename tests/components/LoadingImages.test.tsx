import React from 'react';
import { Image, StyleSheet } from 'react-native';
import { Avatar } from '@/components/Avatar';
import { PlacePhoto } from '@/components/PlaceCard';
const { create, act } = jest.requireActual('react-test-renderer');
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/lib/googlePlaces', () => ({ useEnrichedPlace: (p: unknown) => p }));
let mockPhoto: { uri: string | null; displayKey: string; onDisplay: jest.Mock };
jest.mock('@/hooks/useAvatarSource', () => ({ useAvatarPhoto: () => mockPhoto }));
let tree: any;
beforeEach(() => {
  mockPhoto = {
    uri: 'data:image/jpeg;base64,first',
    displayKey: 'viewer:person:1',
    onDisplay: jest.fn(),
  };
});
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
  tree = null;
});
const shownOpacity = () => StyleSheet.flatten(tree.root.findByType(Image).props.style).opacity;
test('place placeholder reserves image geometry until load; failures keep a neutral fallback', async () => {
  await act(async () => {
    tree = create(<PlacePhoto uri="first" style={{ width: 300, height: 190 }} />);
  });
  expect(shownOpacity()).toBe(0);
  const first = tree.root.findByType(Image).props;
  await act(async () => first.onLoad());
  expect(shownOpacity()).toBe(1);
  await act(async () => first.onError());
  expect(tree.root.findAllByType(Image)).toHaveLength(0);
  const placeholder = tree.root.findAll(
    (n: any) => n.type === 'View' && StyleSheet.flatten(n.props.style)?.height === 190,
  )[0];
  expect(StyleSheet.flatten(placeholder.props.style)).toMatchObject({ width: 300, height: 190 });
  // A late decode completion must not undo an error.
  await act(async () => first.onLoad());
  expect(tree.root.findAllByType(Image)).toHaveLength(0);
});
test('changed place source starts hidden and ignores callbacks from every previous instance', async () => {
  await act(async () => {
    tree = create(<PlacePhoto uri="first" />);
  });
  const first = tree.root.findByType(Image).props;
  await act(async () => first.onLoad());
  await act(async () => tree.update(<PlacePhoto uri="second" />));
  const second = tree.root.findByType(Image).props;
  await act(async () => {
    first.onLoad();
    first.onError();
  });
  expect(tree.root.findByType(Image).props.source.uri).toBe('second');
  expect(shownOpacity()).toBe(0);
  await act(async () => second.onLoad());
  expect(shownOpacity()).toBe(1);
  await act(async () => tree.update(<PlacePhoto uri={null} />));
  await act(async () => {
    second.onError();
    second.onLoad();
  });
  expect(tree.root.findAllByType(Image)).toHaveLength(0);
});
test('avatar initials remain while decoding; only successful current decode marks display', async () => {
  await act(async () => {
    tree = create(<Avatar name="Ava Person" userId="person" />);
  });
  expect(JSON.stringify(tree.toJSON())).toContain('AP');
  expect(shownOpacity()).toBe(0);
  expect(mockPhoto.onDisplay).not.toHaveBeenCalledWith(true);
  const first = tree.root.findByType(Image).props;
  await act(async () => first.onLoad());
  expect(shownOpacity()).toBe(1);
  expect(mockPhoto.onDisplay).toHaveBeenCalledWith(true);
  expect(JSON.stringify(tree.toJSON())).not.toContain('"AP"');
  await act(async () => first.onError());
  expect(tree.root.findAllByType(Image)).toHaveLength(0);
  expect(JSON.stringify(tree.toJSON())).toContain('AP');
  expect(mockPhoto.onDisplay).toHaveBeenLastCalledWith(false);
});
test('avatar replacement, revision and revoked authorization reject old callbacks', async () => {
  await act(async () => {
    tree = create(<Avatar name="Ava" avatarRef={{ userId: 'person', revision: 1 }} />);
  });
  const old = tree.root.findByType(Image).props;
  const previousDisplay = mockPhoto.onDisplay;
  mockPhoto = {
    uri: 'data:image/jpeg;base64,second',
    displayKey: 'viewer:person:2',
    onDisplay: jest.fn(),
  };
  await act(async () =>
    tree.update(<Avatar name="Ben" avatarRef={{ userId: 'person', revision: 2 }} />),
  );
  await act(async () => {
    old.onLoad();
    old.onError();
  });
  expect(previousDisplay).not.toHaveBeenCalledWith(true);
  expect(mockPhoto.onDisplay).not.toHaveBeenCalledWith(true);
  expect(shownOpacity()).toBe(0);
  expect(JSON.stringify(tree.toJSON())).toContain('B');
  const current = tree.root.findByType(Image).props;
  mockPhoto = { ...mockPhoto, uri: null, displayKey: '' };
  await act(async () =>
    tree.update(<Avatar name="Ben" avatarRef={{ userId: 'person', revision: 2 }} />),
  );
  await act(async () => current.onLoad());
  expect(mockPhoto.onDisplay).not.toHaveBeenCalledWith(true);
  expect(tree.root.findAllByType(Image)).toHaveLength(0);
});
test('unmanaged avatars reset on person/source changes; managed avatars never bypass authorization with a raw URI', async () => {
  await act(async () => {
    tree = create(<Avatar name="Ava" uri="first" />);
  });
  const first = tree.root.findByType(Image).props;
  await act(async () => tree.update(<Avatar name="Ben" uri="second" />));
  await act(async () => first.onLoad());
  expect(shownOpacity()).toBe(0);
  mockPhoto.uri = null;
  await act(async () => tree.update(<Avatar name="Ben" userId="person" uri="private-url" />));
  expect(tree.root.findAllByType(Image)).toHaveLength(0);
});
