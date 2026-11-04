import { MessageThread } from './MessageThread';
import { useGroupChat } from '@/hooks/useGroupChat';
import { api } from '@/lib/api';
export function GroupChat({
  groupId,
  userId,
  onRefresh,
}: {
  groupId: string;
  userId: string;
  onRefresh?: () => void | Promise<void>;
}) {
  const chat = useGroupChat(groupId);
  return (
    <MessageThread
      group
      onRefresh={onRefresh}
      userId={userId}
      chat={chat}
      onSend={(input) => api.sendGroupMessage(groupId, input)}
      title="Group chat"
      emptyText="No messages yet. Say hello to your group."
      placeholder="Message your group…"
      inputLabel="Group message"
      reportKind="group_message"
    />
  );
}
