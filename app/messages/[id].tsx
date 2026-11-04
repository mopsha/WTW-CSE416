import { useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { Avatar, Screen, colors, space, type } from '@/components';
import { MemberMenu } from '@/components/MemberMenu';
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
    <Screen
      title="Messages"
      back
      onRefresh={() => void chat.refresh()}
      right={
        peer ? (
          <MemberMenu
            userId={peer.id}
            name={peer.displayName ?? 'WTW friend'}
            onBlocked={() => void chat.refresh()}
          />
        ) : undefined
      }
    >
      {peer ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <Avatar name={peer.displayName ?? 'WTW friend'} uri={peer.avatarUrl} size={48} />
          <View>
            <Text style={{ ...type.heading, color: colors.text }}>
              {peer.displayName ?? 'WTW friend'}
            </Text>
            {peer.username ? (
              <Text style={{ ...type.caption, color: colors.muted }}>@{peer.username}</Text>
            ) : null}
          </View>
        </View>
      ) : null}
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
