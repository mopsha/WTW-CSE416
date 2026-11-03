import { api } from '@/lib/api';
import { groupChatLive } from '@/lib/groupChatLive';
import type { LiveSource } from '@/lib/live';
import { useLiveMessages, MESSAGE_POLL_MS } from './useLiveMessages';
export const GROUP_CHAT_POLL_MS = MESSAGE_POLL_MS;
export function useGroupChat(groupId: string, source: LiveSource = groupChatLive) {
  const { data, ...state } = useLiveMessages(groupId, api.listGroupMessages, source);
  return { ...state, messages: data?.messages ?? [] };
}
