import { EmptyState, Screen } from '@/components';

// Placeholder until the friends feature lands.
export default function FriendsScreen() {
  return (
    <Screen title="Friends" edges={['top', 'left', 'right']}>
      <EmptyState
        emoji="👋"
        title="No friends here yet"
        body="Soon you'll add friends and invite them to Picks from this tab."
      />
    </Screen>
  );
}
