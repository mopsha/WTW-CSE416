import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { api } from '@/lib/api';
import { messageOf } from '@/lib/errors';
import { live as defaultLive, type LiveSource } from '@/lib/live';
import type { PickProgress, PickState } from '@/lib/types';

/** Poll this often when Realtime isn't available. */
export const POLL_MS = 5000;
/** Give the channel this long to say SUBSCRIBED before polling instead. */
export const CONNECT_TIMEOUT_MS = 8000;

export type LiveMode = 'connecting' | 'realtime' | 'polling';

export interface PickLive {
  state: PickState | null;
  progress: PickProgress | null;
  deadline: string | null;
  mode: LiveMode;
  /** The last refresh failed (offline, server down). `progress` is the last good copy. */
  error: string | null;
  refresh: () => Promise<void>;
}

interface Options {
  source?: LiveSource;
  getProgress?: (pickId: string) => Promise<PickProgress>;
}

/**
 * Live state and progress of one Pick: Realtime on `picks` (state) and `pick_participants`
 * (who's done), re-reading GET /picks/:id/progress on each change. If the channel errors or
 * never connects, it polls that route every 5 s instead. It also re-reads whenever the app
 * comes back to the foreground.
 */
export function usePickLive(
  pickId: string,
  { source = defaultLive, getProgress = api.getProgress }: Options = {},
): PickLive {
  const [progress, setProgress] = useState<PickProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<LiveMode>('connecting');
  const inflight = useRef<Promise<void> | null>(null);
  const again = useRef(false);

  // Coalesce bursts (a Realtime event per row) into one request at a time plus one trailing.
  const refresh = useCallback((): Promise<void> => {
    if (inflight.current) {
      again.current = true;
      return inflight.current;
    }
    const run = (async () => {
      try {
        do {
          again.current = false;
          const next = await getProgress(pickId);
          setProgress(next);
          setError(null);
        } while (again.current);
      } catch (e) {
        setError(messageOf(e));
      } finally {
        inflight.current = null;
      }
    })();
    inflight.current = run;
    return run;
  }, [pickId, getProgress]);

  useEffect(() => {
    void refresh();
    let settled = false;
    const unsubscribe = source.subscribe(
      pickId,
      () => void refresh(),
      (status) => {
        settled = true;
        setMode(status === 'live' ? 'realtime' : 'polling');
        // Catch anything that changed between the first read and the subscription.
        if (status === 'live') void refresh();
      },
    );
    const timeout = setTimeout(() => {
      if (!settled) setMode('polling');
    }, CONNECT_TIMEOUT_MS);
    return () => {
      clearTimeout(timeout);
      unsubscribe();
    };
  }, [pickId, refresh, source]);

  // Fallback polling; also keep polling while the last read failed, so we recover by ourselves.
  useEffect(() => {
    if (mode !== 'polling' && !error) return;
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [mode, error, refresh]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  return {
    state: progress?.state ?? null,
    progress,
    deadline: progress?.deadlineAt ?? null,
    mode,
    error,
    refresh,
  };
}
