import { EmptyState, Screen } from '@/components';

// Placeholder until the Discover feature is scoped (Week 3+).
export default function DiscoverScreen() {
  return (
    <Screen title="Discover" edges={['top', 'left', 'right']}>
      <EmptyState
        emoji="🧭"
        title="Coming soon"
        body="Trending spots near you and ideas for your next Pick will live here."
      />
    </Screen>
  );
}
