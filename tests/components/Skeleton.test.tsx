import React from 'react';
import { Image, StyleSheet } from 'react-native';
import { Skeleton, SkeletonCard, SkeletonRegion, SkeletonRow } from '@/components/Skeleton';
import {
  PlaceCardsSkeleton,
  ProfileSkeleton,
  PickResultSkeleton,
  ActivePicksSkeleton,
  RowsSkeleton,
  HistorySkeleton,
  GroupCardsSkeleton,
  GroupDetailsSkeleton,
} from '@/components/LoadingStates';
const { create, act } = jest.requireActual('react-test-renderer');
test.each([
  [<PlaceCardsSkeleton key="0" />, 'Loading places'],
  [<ProfileSkeleton key="1" />, 'Loading profile'],
  [<ProfileSkeleton own key="2" />, 'Loading profile details'],
  [<PickResultSkeleton image={false} key="3" />, 'Loading Pick results'],
  [<ActivePicksSkeleton key="4" />, 'Loading your Picks'],
  [<RowsSkeleton label="Loading friends" key="5" />, 'Loading friends'],
  [<HistorySkeleton key="6" />, 'Loading Recent History'],
  [<GroupCardsSkeleton key="7" />, 'Loading your groups'],
  [<GroupDetailsSkeleton key="8" />, 'Loading the group'],
])(
  'loading composition has one accessible announcement and no interactive/native-image content: %s',
  async (element, label) => {
    let tree: any;
    await act(async () => {
      tree = create(element);
    });
    const regions = tree.root.findAll((n: any) => n.type === 'View' && n.props.accessible);
    expect(regions).toHaveLength(1);
    expect(regions[0].props).toMatchObject({
      accessibilityLabel: label,
      accessibilityState: { busy: true },
      pointerEvents: 'none',
    });
    expect(tree.root.findAllByType(Image)).toHaveLength(0);
    expect(tree.root.findAll((n: any) => n.props.accessibilityRole === 'button')).toHaveLength(0);
    await act(async () => tree.unmount());
  },
);
test('circle, image and line shapes preserve geometry and stay hidden from accessibility', async () => {
  let tree: any;
  await act(async () => {
    tree = create(
      <SkeletonRegion label="Loading">
        <SkeletonCard>
          <Skeleton variant="circle" size={84} />
          <Skeleton height={190} />
          <Skeleton variant="line" width="65%" />
          <SkeletonRow />
        </SkeletonCard>
      </SkeletonRegion>,
    );
  });
  const shapes = tree.root.findAll((n: any) => n.type === 'View' && n.props.accessible === false);
  expect(shapes.length).toBeGreaterThanOrEqual(3);
  expect(StyleSheet.flatten(shapes[0].props.style)).toMatchObject({
    width: 84,
    height: 84,
    borderRadius: 42,
  });
  expect(StyleSheet.flatten(shapes[1].props.style)).toMatchObject({ width: '100%', height: 190 });
  for (const shape of shapes)
    expect(shape.props).toMatchObject({
      accessibilityElementsHidden: true,
      importantForAccessibility: 'no-hide-descendants',
    });
  await act(async () => tree.unmount());
});
