import { View } from 'react-native';
import { Skeleton, SkeletonCard, SkeletonRegion, SkeletonRow } from './Skeleton';
import { radius, space } from './theme';

export function PlaceCardsSkeleton() {
  return (
    <SkeletonRegion label="Loading places">
      {[0, 1].map((i) => (
        <SkeletonCard
          key={i}
          style={{ minHeight: 180, justifyContent: 'flex-end', paddingTop: 80 }}
        >
          <Skeleton variant="line" width="70%" height={28} />
          <Skeleton variant="line" width="90%" height={20} />
        </SkeletonCard>
      ))}
    </SkeletonRegion>
  );
}
export function RowsSkeleton({
  label,
  avatarSize = 60,
  count = 2,
}: {
  label: string;
  avatarSize?: number;
  count?: number;
}) {
  return (
    <SkeletonRegion label={label}>
      {Array.from({ length: count }, (_, i) => (
        <SkeletonRow key={i} avatarSize={avatarSize} />
      ))}
    </SkeletonRegion>
  );
}
export function ActivePicksSkeleton() {
  return (
    <SkeletonRegion label="Loading your Picks">
      <SkeletonCard style={{ minHeight: 108, paddingLeft: space.xl }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Skeleton width={40} height={40} />
          <Skeleton width={80} height={24} />
        </View>
        <Skeleton variant="line" width="72%" />
      </SkeletonCard>
    </SkeletonRegion>
  );
}
export function HistorySkeleton({
  label = 'Loading Recent History',
  card = false,
}: {
  label?: string;
  card?: boolean;
}) {
  return (
    <SkeletonRegion label={label}>
      {card ? (
        <SkeletonCard style={{ minHeight: 136 }}>
          <Skeleton variant="line" width="45%" height={18} />
          <Skeleton variant="line" width="75%" />
          <Skeleton variant="line" width="60%" height={18} />
        </SkeletonCard>
      ) : (
        <SkeletonRow avatarSize={40} trailing={false} compact />
      )}
    </SkeletonRegion>
  );
}
export function ProfileSkeleton({ own = false }: { own?: boolean }) {
  return (
    <SkeletonRegion label={own ? 'Loading profile details' : 'Loading profile'}>
      <View
        style={{
          flexDirection: own ? 'row' : 'column',
          alignItems: 'center',
          gap: space.lg,
          paddingVertical: space.lg,
        }}
      >
        <Skeleton variant="circle" size={own ? 104 : 84} />
        <View style={{ gap: space.sm, width: own ? '55%' : '70%' }}>
          <Skeleton variant="line" />
          <Skeleton variant="line" width="70%" />
          <View style={{ flexDirection: 'row', gap: space.md }}>
            <Skeleton width="40%" height={47} />
            <Skeleton width="40%" height={47} />
          </View>
        </View>
      </View>
      <SkeletonCard>
        <Skeleton variant="line" width="50%" />
        <Skeleton variant="line" width="75%" />
      </SkeletonCard>
    </SkeletonRegion>
  );
}
/** Neutral shapes reserve result geometry without claiming an outcome or fabricating a winner. */
export function PickResultSkeleton({ image = true }: { image?: boolean }) {
  return (
    <SkeletonRegion label="Loading Pick results">
      <Skeleton variant="line" width="50%" />
      <Skeleton variant="line" width="80%" />
      <SkeletonCard style={{ padding: 0 }}>
        {image ? <Skeleton height={190} style={{ borderRadius: 0 }} /> : null}
        <View style={{ gap: space.sm, padding: space.lg }}>
          <Skeleton variant="line" width="35%" height={18} />
          <Skeleton variant="line" width="65%" height={28} />
          <Skeleton variant="line" width="85%" />
          <Skeleton width="55%" height={32} />
        </View>
      </SkeletonCard>
      <Skeleton height={50} style={{ borderRadius: radius.pill }} />
      <SkeletonCard>
        <Skeleton variant="line" width="55%" />
        <Skeleton height={44} />
      </SkeletonCard>
    </SkeletonRegion>
  );
}

export function GroupCardsSkeleton() {
  return (
    <SkeletonRegion label="Loading your groups">
      {[0, 1].map((i) => (
        <SkeletonCard key={i}>
          <View
            style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.md }}
          >
            <View style={{ flex: 1, minWidth: 80, gap: space.xs }}>
              <Skeleton variant="line" width="80%" />
              <Skeleton variant="line" width="55%" height={18} />
            </View>
            <Skeleton width={116} height={50} />
          </View>
        </SkeletonCard>
      ))}
    </SkeletonRegion>
  );
}
export function GroupDetailsSkeleton() {
  return (
    <SkeletonRegion label="Loading the group">
      <View style={{ alignItems: 'center', gap: space.sm, paddingVertical: space.sm }}>
        <Skeleton variant="circle" size={64} />
        <Skeleton variant="line" width="65%" />
        <Skeleton variant="line" width="35%" height={18} />
      </View>
      <SkeletonCard>
        <SkeletonRow avatarSize={24} compact />
        <SkeletonRow avatarSize={24} compact />
      </SkeletonCard>
    </SkeletonRegion>
  );
}
