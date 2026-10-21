import { useCallback, useState } from 'react';
import { RefreshControl } from 'react-native';

import { colors } from '@/components/theme';

/**
 * Pull-to-refresh for the live Pick screens: re-reads now instead of waiting for Realtime or the
 * 5 s poll (the demo script's "a phone shows a stale screen" fallback). Pass the result as a
 * ScrollView's `refreshControl`.
 */
export function usePullToRefresh(refresh: () => Promise<unknown>) {
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void refresh().finally(() => setRefreshing(false));
  }, [refresh]);
  return (
    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
  );
}
