import { USE_MOCK } from './config';
import { getSupabase } from './supabase';
import { isFailedStatus, type LiveSource } from './live';
export function createMessageLive(
  table: 'group_messages' | 'direct_messages',
  column: 'group_id' | 'conversation_id',
  mockSubscribe: (id: string, change: () => void) => () => void,
): LiveSource {
  return {
    subscribe(id, change, status) {
      if (USE_MOCK) {
        status('live');
        return mockSubscribe(id, change);
      }
      const client = getSupabase();
      const channel = client
        .channel(`${table}:${id}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table, filter: `${column}=eq.${id}` },
          change,
        )
        .subscribe((s) => {
          if (s === 'SUBSCRIBED') status('live');
          else if (isFailedStatus(s)) status('failed');
        });
      return () => {
        void client.removeChannel(channel);
      };
    },
  };
}
