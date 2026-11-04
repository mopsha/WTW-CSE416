import { MemberMenu } from '@/components/MemberMenu';
import { useLocalSearchParams } from 'expo-router';
import { Screen } from '@/components';
import { ConversationHeader } from '@/components/ConversationHeader';
import { MessageThread } from '@/components/MessageThread';
import { useSession } from '@/hooks/useAuth';
import { useDirectChat } from '@/hooks/useDirectChat';
import { api } from '@/lib/api';
export default function DirectMessageScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const session = useSession();
  return <Conversation key={`${id}:${session.user.id}`} id={id} userId={session.user.id} />;
}
function Conversation({ id, userId }: { id: string; userId: string }) {
  const chat = useDirectChat(id);
  const peer = chat.conversation?.peer;
  return (
    <Screen scroll={false} contentStyle={{ padding: 0, paddingBottom: 0, gap: 0 }}>
      <ConversationHeader
        right={
          peer ? (
            <MemberMenu
              userId={peer.id}
              name={peer.displayName ?? 'WTW friend'}
              onBlocked={() => void chat.refresh()}
            />
          ) : undefined
        }
        name={
          peer
            ? peer.displayName || (peer.username ? `@${peer.username}` : 'WTW friend')
            : undefined
        }
        unavailable={chat.unavailable}
        loading={!peer && !chat.error && !chat.unavailable}
        uri={peer?.avatarUrl}
        subtitle={peer?.username ? `@${peer.username}` : undefined}
      />
      <MessageThread
        userId={userId}
        chat={{ ...chat, unavailable: chat.unavailable || !peer }}
        onSend={(input) => api.sendDirectMessage(id, input)}
        title="Direct chat"
        emptyText="No messages yet. Say hello to your friend."
        placeholder="Message your friend…"
        inputLabel="Direct message"
        reportKind="direct_message"
      />
    </Screen>
  );
}
