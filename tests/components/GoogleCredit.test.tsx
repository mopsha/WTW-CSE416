import React from 'react';
import { Linking } from 'react-native';
import { GoogleCredit } from '@/components/GoogleCredit';
import { candidateFromApi, safeLink } from '@/lib/places';

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
