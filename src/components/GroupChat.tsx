import { MessageThread, type MessageDraft } from './MessageThread';
import { useGroupChat } from '@/hooks/useGroupChat';
import { api } from '@/lib/api';
export function GroupChat({
  groupId,
  userId,
  onRefresh,
  composerRef,
}: {
  composerRef?: MessageDraft;
  groupId: string;
  userId: string;
  onRefresh?: () => void | Promise<void>;
}) {
  const chat = useGroupChat(groupId);
  return (
    <MessageThread
      group
      composerRef={composerRef}
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
