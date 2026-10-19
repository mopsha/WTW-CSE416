import { router } from 'expo-router';
import { useEffect, useRef } from 'react';

import { pathFor, redirectFor, type PickScreen } from '@/lib/pickRoute';
import type { PickState } from '@/lib/types';

/**
 * Keeps this screen in step with the Pick's state: when the state no longer belongs here
 * (the host closed, the vote settled, it was canceled) it replaces the screen with the right one.
 */
export function usePickRoute(
  pickId: string,
  screen: PickScreen,
  state: PickState | null,
  opts: { allAnswered?: boolean } = {},
) {
  const previous = useRef<PickState | null>(null);
  const { allAnswered } = opts;

  useEffect(() => {
    if (!state) return;
    const target = redirectFor(screen, state, { allAnswered, from: previous.current });
    previous.current = state;
    if (target) router.replace({ pathname: pathFor(target), params: { id: pickId } });
  }, [pickId, screen, state, allAnswered]);
}
