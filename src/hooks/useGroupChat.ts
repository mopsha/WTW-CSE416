import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { GroupMessage } from '@shared/api/groupChat.ts';
import { api } from '@/lib/api';
import { messageOf } from '@/lib/errors';
import { groupChatLive } from '@/lib/groupChatLive';
import type { LiveSource } from '@/lib/live';

export const GROUP_CHAT_POLL_MS = 5000;
export function useGroupChat(groupId: string, source: LiveSource = groupChatLive) {
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [mode, setMode] = useState<'connecting' | 'realtime' | 'polling'>('connecting');
  const reload = useRef<() => Promise<void>>(async () => {});
  useFocusEffect(
    useCallback(() => {
      setMode('connecting');
      setMessages([]);
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
          const next = await api.listGroupMessages(groupId);
          if (active && foreground && requestEpoch === epoch) {
            setMessages(next.messages);
            setError(null);
            setUnavailable(false);
          }
        } catch (e) {
          if (active) {
            // Never retain private chat content after access cannot be verified.
            setMessages([]);
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
          groupId,
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
      const timer = setInterval(() => void load(), GROUP_CHAT_POLL_MS);
      const subscription = AppState.addEventListener('change', (state) => {
        epoch += 1;
        foreground = state === 'active';
        if (foreground) void load();
        else setMessages([]);
      });
      return () => {
        active = false;
        setMessages([]);
        setLoading(true);
        clearInterval(timer);
        clearTimeout(timeout);
        unsubscribe();
        subscription.remove();
        reload.current = async () => {};
      };
    }, [groupId, source]),
  );
  return { messages, loading, error, unavailable, mode, refresh: () => reload.current() };
}
