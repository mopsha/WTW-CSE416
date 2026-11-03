import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { Message } from '@shared/api/messages.ts';
import { messageOf } from '@/lib/errors';
import type { LiveSource } from '@/lib/live';

export const MESSAGE_POLL_MS = 5000;
export function useLiveMessages<S extends { messages: Message[] }>(
  resourceId: string,
  loadHistory: (id: string) => Promise<S>,
  source: LiveSource,
) {
  const [data, setData] = useState<S | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [mode, setMode] = useState<'connecting' | 'realtime' | 'polling'>('connecting');
  const reload = useRef<() => Promise<void>>(async () => {});
  useFocusEffect(
    useCallback(() => {
      setMode('connecting');
      setData(null);
      setLoading(true);
      setError(null);
      setUnavailable(false);
      let active = true;
      let foreground =
        AppState.currentState !== 'background' && AppState.currentState !== 'inactive';
      let inflight = false;
      let again = false;
      let revoked = false;
      let epoch = 0;
      async function load() {
        if (!active || !foreground || revoked) return;
        if (inflight) {
          again = true;
          return;
        }
        inflight = true;
        const requestEpoch = epoch;
        try {
          const next = await loadHistory(resourceId);
          if (active && foreground && requestEpoch === epoch) {
            setData(next);
            setError(null);
            setUnavailable(false);
          }
        } catch (e) {
          if (active && foreground && requestEpoch === epoch) {
            // Never retain private chat content after access cannot be verified.
            setData(null);
            setError(messageOf(e));
            revoked =
              typeof e === 'object' &&
              e !== null &&
              'status' in e &&
              [401, 403, 404].includes(Number(e.status));
            setUnavailable(revoked);
          }
        } finally {
          inflight = false;
          if (active) setLoading(false);
          if (again) {
            again = false;
            void load();
          }
        }
      }
      reload.current = async () => {
        revoked = false;
        await load();
      };
      void load();
      let unsubscribe = () => {};
      try {
        unsubscribe = source.subscribe(
          resourceId,
          () => void load(),
          (status) => {
            if (active) setMode(status === 'live' ? 'realtime' : 'polling');
            if (status === 'live') void load();
          },
        );
      } catch {
        setMode('polling');
      }
      const timeout = setTimeout(() => setMode((m) => (m === 'connecting' ? 'polling' : m)), 8000);
      // Even with Realtime, recheck membership/blocking: revocation need not insert a message.
      const timer = setInterval(() => void load(), MESSAGE_POLL_MS);
      const subscription = AppState.addEventListener('change', (state) => {
        epoch += 1;
        foreground = state === 'active';
        if (foreground) void load();
        else setData(null);
      });
      return () => {
        active = false;
        setData(null);
        setLoading(true);
        clearInterval(timer);
        clearTimeout(timeout);
        unsubscribe();
        subscription.remove();
        reload.current = async () => {};
      };
    }, [resourceId, loadHistory, source]),
  );
  return { data, loading, error, unavailable, mode, refresh: () => reload.current() };
}
