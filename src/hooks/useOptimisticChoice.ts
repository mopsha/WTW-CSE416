import { useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { OptimisticChoice } from '@/lib/optimisticChoice';

/** Owner must key its component by account AND entity. No pending choices survive unmount. */
export function useOptimisticChoice<T, S>(create: () => OptimisticChoice<T, S>) {
  const [choice] = useState(create);
  useLayoutEffect(() => {
    choice.activate();
    return () => choice.dispose();
  }, [choice]);
  const state = useSyncExternalStore(choice.subscribe, choice.snapshot, choice.snapshot);
  return { choice, ...state };
}
