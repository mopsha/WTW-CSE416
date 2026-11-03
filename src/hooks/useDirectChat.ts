import { api } from '@/lib/api';
import { directChatLive } from '@/lib/directChatLive';
import { useLiveMessages } from './useLiveMessages';
export function useDirectChat(id: string) {
  const { data, ...state } = useLiveMessages(id, api.listDirectMessages, directChatLive);
  return { ...state, conversation: data?.conversation ?? null, messages: data?.messages ?? [] };
}
