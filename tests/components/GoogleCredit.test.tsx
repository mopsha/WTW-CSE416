import React from 'react';
import { Linking } from 'react-native';
import { PlaceCard } from '@/components/PlaceCard';
import { GoogleCredit } from '@/components/GoogleCredit';
import { candidateFromApi, safeLink } from '@/lib/places';

jest.mock('@/lib/googlePlaces', () => ({ useEnrichedPlace: (place: unknown) => place }));

type Node = { props: Record<string, any> };
type Tree = {
  root: { findAll(test: (n: Node) => boolean): Node[] };
  toJSON(): unknown;
  unmount(): void;
};
const { create, act } = jest.requireActual<{
  create(element: React.ReactElement): Tree;
  act(work: () => void | Promise<void>): Promise<void>;
}>('react-test-renderer');

async function mount(place: React.ComponentProps<typeof GoogleCredit>['place']) {
  let tree!: Tree;
  await act(async () => {
    tree = create(<GoogleCredit place={place} />);
  });
  return tree;
}
const links = (tree: Tree) =>
  tree.root.findAll((n) => n.props.accessibilityRole === 'link' && !!n.props.onPress);

test('the API credit link survives normalization and opens', async () => {
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  const place = candidateFromApi({
    placeId: 'g',
    name: 'Cafe',
    provider: 'google',
    googleMapsUri: 'https://maps.google.com/?cid=1',
    attributions: [{ provider: 'Ana', providerUri: 'https://maps.google.com/contrib/1' }],
  });
  const tree = await mount(place);
  const found = links(tree);
  expect(new Set(found.map((n) => n.props.accessibilityLabel))).toEqual(
    new Set(['Google Maps, opens outside WTW', 'Ana, opens outside WTW']),
  );
  await act(async () =>
    found.find((n) => n.props.accessibilityLabel.startsWith('Ana'))!.props.onPress(),
  );
  expect(open).toHaveBeenCalledWith('https://maps.google.com/contrib/1');
  await act(async () => tree.unmount());
});

test('place, photographer and photo each keep their own link', async () => {
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  open.mockClear();
  const tree = await mount(
    candidateFromApi({
      placeId: 'g',
      name: 'Cafe',
      provider: 'google',
      googleMapsUri: 'https://maps.google.com/place',
      photoGoogleMapsUri: 'https://maps.google.com/photo',
      attributions: [{ provider: 'Ana', providerUri: 'https://maps.google.com/author' }],
    }),
  );
  const opened: Record<string, string> = {};
  for (const link of links(tree)) {
    await act(async () => link.props.onPress());
    opened[link.props.accessibilityLabel] = open.mock.lastCall![0];
  }
  expect(opened).toEqual({
    'Google Maps, opens outside WTW': 'https://maps.google.com/place',
    'Ana, opens outside WTW': 'https://maps.google.com/author',
    'Photo source, opens outside WTW': 'https://maps.google.com/photo',
  });
  await act(async () => tree.unmount());
});

test('credits without links still show, as plain text', async () => {
  const tree = await mount({ provider: 'google', attributions: [{ provider: 'Ana' }] });
  expect(links(tree)).toHaveLength(0);
  const json = JSON.stringify(tree.toJSON());
  expect(json).toContain('Google Maps');
  expect(json).toContain('Ana');
  await act(async () => tree.unmount());
});

test('other providers show no credit', async () => {
  const tree = await mount({ provider: 'mock' });
  expect(tree.toJSON()).toBeNull();
  await act(async () => tree.unmount());
});

test('only web links can open', () => {
  expect(safeLink('https://a.example/x')).toBe('https://a.example/x');
  expect(safeLink('//a.example/x')).toBe('https://a.example/x');
  expect(safeLink('javascript:alert(1)')).toBeNull();
  expect(safeLink('http://a.example')).toBeNull();
  expect(safeLink(undefined)).toBeNull();
});

test('long attribution links use bounded wrapping targets without inflated hit regions', async () => {
  const { StyleSheet } = jest.requireActual('react-native');
  const tree = await mount({
    provider: 'google',
    googleMapsUri: 'https://maps.google.com/place',
    attributions: [
      {
        provider: 'A long photographer name that must remain readable',
        uri: 'https://maps.google.com/author',
      },
    ],
  });
  for (const link of links(tree)) {
    const style = StyleSheet.flatten(link.props.style({ pressed: false }));
    expect(style.minHeight).toBeGreaterThanOrEqual(44);
    expect(style.minWidth).toBeGreaterThanOrEqual(44);
    expect(style.maxWidth).toBe('100%');
    expect(link.props.hitSlop).toBeUndefined();
    expect(link.props.numberOfLines).toBeUndefined();
  }
  expect(JSON.stringify(tree.toJSON())).toContain(
    'A long photographer name that must remain readable',
  );
  await act(async () => tree.unmount());
});

test('a separate photo credit does not suppress required Google source links on a place card', async () => {
  const place = {
    ...candidateFromApi({
      placeId: 'g',
      name: 'Cafe',
      provider: 'google',
      googleMapsUri: 'https://maps.google.com/place',
    }),
    photoCredit: 'Photo author',
  };
  let tree!: Tree;
  await act(async () => {
    tree = create(<PlaceCard place={place} />);
  });
  expect(
    links(tree).some((link) => link.props.accessibilityLabel === 'Google Maps, opens outside WTW'),
  ).toBe(true);
  expect(JSON.stringify(tree.toJSON())).toContain('Photo author');
  await act(async () => tree.unmount());
});
