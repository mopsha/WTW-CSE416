import { USE_MOCK } from './config';
import { getSupabase } from './supabase';
import { isFailedStatus, type LiveSource } from './live';
import { subscribeMockGroupChat } from './mock/groupChat';

/** Events only invalidate history; authenticated API reads remain the displayed source. */
export const groupChatLive: LiveSource = {
  subscribe(groupId, change, status) {
    if (USE_MOCK) {
      status('live');
      return subscribeMockGroupChat(groupId, change);
    }
    const client = getSupabase();
    const channel = client
      .channel(`group-chat:${groupId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'group_messages',
          filter: `group_id=eq.${groupId}`,
        },
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
