import { Ionicons } from '@expo/vector-icons';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  MESSAGE_MAX,
  parseMessage,
  type Message,
  type MessageInput,
} from '@shared/api/messages.ts';
import { messageOf } from '@/lib/errors';
import { timeAgo } from '@/lib/time';
import { SafetySheet } from './MemberMenu';
import {
  Avatar,
  Button,
  Card,
  colors,
  ErrorState,
  MIN_TARGET,
  radius,
  space,
  type,
} from '@/components';

let sequence = 0;
export interface MessageThreadState {
  messages: Message[];
  loading: boolean;
  error: string | null;
  unavailable: boolean;
  mode: 'connecting' | 'realtime' | 'polling';
  refresh(): Promise<void>;
}
export function MessageThread({
  userId,
  chat,
  onSend,
  title,
  emptyText,
  placeholder,
  inputLabel,
  reportKind,
}: {
  userId: string;
  chat: MessageThreadState;
  onSend(input: MessageInput): Promise<unknown>;
  title: string;
  emptyText: string;
  placeholder: string;
  inputLabel: string;
  reportKind: 'group_message' | 'direct_message';
}) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flagged, setFlagged] = useState<{ message: Message; name: string } | null>(null);
  const pending = useRef(false);
  const attempt = useRef<{ body: string; clientId: string } | null>(null);
  const history = useRef<ScrollView>(null);
  const atBottom = useRef(true);
  async function send() {
    if (pending.current || chat.unavailable) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      const text = body.trim();
      if (!attempt.current || attempt.current.body !== text)
        attempt.current = {
          body: text,
          clientId: `chat-${Date.now().toString(36)}-${++sequence}-${Math.random().toString(36).slice(2)}`,
        };
      const input = parseMessage(attempt.current);
      await onSend(input);
      attempt.current = null;
      setBody('');
      atBottom.current = true;
      await chat.refresh();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <Card>
      <Text style={s.heading} accessibilityRole="header">
        {title}
      </Text>
      <Text style={s.caption}>
        {chat.mode === 'realtime'
          ? 'Live updates'
          : chat.mode === 'connecting'
            ? 'Connecting…'
            : 'Refreshes every 5 seconds'}{' '}
        · latest 50 messages
      </Text>
      {chat.loading ? (
        <ActivityIndicator color={colors.primary} accessibilityLabel={`Loading ${title}`} />
      ) : null}
      {chat.error ? (
        <ErrorState variant="banner" message={chat.error} onRetry={() => void chat.refresh()} />
      ) : null}
      {!chat.loading && !chat.error && !chat.messages.length ? (
        <Text style={s.caption}>{emptyText}</Text>
      ) : null}
      <ScrollView
        ref={history}
        nestedScrollEnabled
        style={s.history}
        keyboardShouldPersistTaps="handled"
        onScroll={(event) => {
          const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
          atBottom.current = contentOffset.y + layoutMeasurement.height >= contentSize.height - 32;
        }}
        scrollEventThrottle={100}
        onContentSizeChange={() => {
          if (atBottom.current) history.current?.scrollToEnd({ animated: false });
        }}
      >
        <View style={{ gap: space.md }}>
          {chat.messages.map((message) => {
            const name =
              message.senderName ||
              (message.senderUsername ? `@${message.senderUsername}` : 'WTW member');
            return (
              <View key={message.id} style={[s.message, message.senderId === userId && s.own]}>
                <Avatar name={name} uri={message.senderAvatarUrl} size={32} />
                <View style={{ flex: 1, gap: space.xs }}>
                  <Text style={s.caption}>
                    {message.senderId === userId ? 'You' : name} · {timeAgo(message.createdAt)}
                  </Text>
                  <Text style={s.body} selectable>
                    {message.body}
                  </Text>
                </View>
                {message.senderId !== userId ? (
                  <Pressable
                    onPress={() => setFlagged({ message, name })}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`Options for message from ${name}`}
                    accessibilityHint="Report this message or block the sender"
                    style={s.options}
                  >
                    <Ionicons name="ellipsis-horizontal" size={18} color={colors.muted} />
                  </Pressable>
                ) : null}
              </View>
            );
          })}
        </View>
      </ScrollView>
      {error ? <ErrorState variant="banner" message={error} /> : null}
      <TextInput
        style={s.input}
        value={body}
        onChangeText={setBody}
        multiline
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        accessibilityLabel={inputLabel}
        maxLength={MESSAGE_MAX * 2}
        editable={!busy && !chat.unavailable}
      />
      <Text style={s.caption}>
        {[...body.trim()].length}/{MESSAGE_MAX}
      </Text>
      <Button
        label="Send message"
        loading={busy}
        disabled={!body.trim() || chat.unavailable}
        onPress={() => void send()}
      />
      {flagged ? (
        <SafetySheet
          onClose={() => setFlagged(null)}
          userId={flagged.message.senderId}
          name={flagged.name}
          target={{ kind: reportKind, id: flagged.message.id }}
          onBlocked={() => void chat.refresh()}
        />
      ) : null}
    </Card>
  );
}
const s = StyleSheet.create({
  heading: { ...type.heading, color: colors.text },
  caption: { ...type.caption, color: colors.muted },
  body: { ...type.body, color: colors.text },
  history: { maxHeight: 360 },
  message: { flexDirection: 'row', gap: space.sm, padding: space.sm, borderRadius: radius.sm },
  own: { backgroundColor: colors.cardHi },
  options: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  input: {
    ...type.body,
    color: colors.text,
    backgroundColor: colors.bg,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.md,
    minHeight: MIN_TARGET,
    maxHeight: 140,
    textAlignVertical: 'top',
  },
});
