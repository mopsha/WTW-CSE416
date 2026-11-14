import { Ionicons } from '@expo/vector-icons';
import { SafetySheet } from './MemberMenu';
import { SocialIdentity } from './friends/SocialRow';
import { messageTheme } from './theme';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  ActivityIndicator,
  RefreshControl,
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
import { Button, colors, ErrorState, MIN_TARGET, radius, space } from '@/components';

let sequence = 0;
export interface MessageThreadState {
  messages: Message[];
  loading: boolean;
  error: string | null;
  unavailable: boolean;
  mode: 'connecting' | 'realtime' | 'polling';
  refresh(): Promise<void>;
}
/** Route-owned, memory-only composer state; never contains message history. */
interface MessageDraftState {
  body: string;
  attempt: { body: string; clientId: string } | null;
  pending: boolean;
  viewport?: { offset: number; atBottom: boolean };
  notify?: () => void;
}
export type MessageDraft = { current: MessageDraftState };
export const emptyMessageDraft = (): MessageDraft => ({
  current: { body: '', attempt: null, pending: false },
});
export function MessageThread({
  userId,
  chat,
  onSend,
  title,
  emptyText,
  placeholder,
  inputLabel,
  group = false,
  onRefresh,
  reportKind,
  composerRef,
}: {
  composerRef?: MessageDraft;
  userId: string;
  chat: MessageThreadState;
  onSend(input: MessageInput): Promise<unknown>;
  title: string;
  emptyText: string;
  placeholder: string;
  inputLabel: string;
  group?: boolean;
  reportKind: 'group_message' | 'direct_message';
  onRefresh?: () => void | Promise<void>;
}) {
  const [flagged, setFlagged] = useState<{ message: Message; name: string } | null>(null);
  const localComposerRef = useRef(emptyMessageDraft().current);
  const stateRef = composerRef ?? localComposerRef;
  const [body, setBody] = useState('');
  const [inputHeight, setInputHeight] = useState(MIN_TARGET);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useLayoutEffect(() => {
    const current = stateRef.current;
    const notify = () => {
      setBody(current.body);
      setBusy(current.pending);
    };
    current.notify = notify;
    notify();
    return () => {
      if (current.notify === notify) current.notify = undefined;
    };
  }, [stateRef]);
  useEffect(() => {
    if (composerRef && chat.unavailable) {
      stateRef.current.body = '';
      stateRef.current.attempt = null;
      stateRef.current.viewport = undefined;
      stateRef.current.notify?.();
    }
  }, [chat.unavailable, composerRef, stateRef]);
  const [refreshing, setRefreshing] = useState(false);
  const refreshingPending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const history = useRef<ScrollView>(null);
  const atBottom = useRef(true);
  const scrollOffset = useRef(0);
  useLayoutEffect(() => {
    atBottom.current = chat.unavailable ? true : (stateRef.current.viewport?.atBottom ?? true);
    scrollOffset.current = chat.unavailable ? 0 : (stateRef.current.viewport?.offset ?? 0);
  }, [stateRef, chat.unavailable]);
  const restoreScroll = () => {
    if (chat.loading) return;
    if (atBottom.current) history.current?.scrollToEnd({ animated: false });
    else history.current?.scrollTo({ y: scrollOffset.current, animated: false });
  };
  async function send() {
    const current = stateRef.current;
    if (current.pending || chat.unavailable) return;
    current.pending = true;
    setBusy(true);
    setError(null);
    const submittedDraft = current.body;
    let delivered = false;
    try {
      const text = submittedDraft.trim();
      if (!current.attempt || current.attempt.body !== text)
        current.attempt = {
          body: text,
          clientId: `chat-${Date.now().toString(36)}-${++sequence}-${Math.random().toString(36).slice(2)}`,
        };
      const input = parseMessage(current.attempt);
      await onSend(input);
      current.attempt = null;
      delivered = true;
      // Only remove the delivered prefix; a rewritten draft belongs to the user.
      const remaining = current.body.startsWith(submittedDraft)
        ? current.body.slice(submittedDraft.length)
        : current.body;
      current.body = remaining;
      current.notify?.();
      if (mounted.current) {
        if (!remaining) setInputHeight(MIN_TARGET);
        atBottom.current = true;
      }
    } catch (e) {
      if (mounted.current) setError(messageOf(e));
    } finally {
      current.pending = false;
      current.notify?.();
    }
    // Delivery is complete: history reconciliation must not hold the send lock.
    if (delivered && mounted.current) {
      void Promise.resolve()
        .then(() => {
          if (mounted.current) return chat.refresh();
        })
        .catch((e) => {
          if (mounted.current) setError(messageOf(e));
        });
    }
  }

  async function refresh() {
    if (refreshingPending.current) return;
    refreshingPending.current = true;
    setRefreshing(true);
    setError(null);
    try {
      const results = await Promise.allSettled([
        Promise.resolve().then(() => {
          if (mounted.current) return chat.refresh();
        }),
        Promise.resolve().then(() => onRefresh?.()),
      ]);
      const failed = results.find((result) => result.status === 'rejected');
      if (mounted.current && failed?.status === 'rejected') setError(messageOf(failed.reason));
    } finally {
      refreshingPending.current = false;
      if (mounted.current) setRefreshing(false);
    }
  }
  return (
    <View style={s.thread}>
      {!group ? (
        <Text style={s.context} accessibilityLiveRegion="polite">
          {chat.mode === 'realtime'
            ? 'Live updates'
            : chat.mode === 'connecting'
              ? 'Connecting…'
              : 'Refreshes every 5 seconds'}{' '}
          · latest 50 messages
        </Text>
      ) : chat.mode === 'connecting' ? (
        <Text style={s.context} accessibilityLiveRegion="polite">
          Connecting…
        </Text>
      ) : null}
      {chat.error ? (
        <View style={s.notice}>
          <ErrorState variant="banner" message={chat.error} onRetry={() => void chat.refresh()} />
        </View>
      ) : null}
      <ScrollView
        ref={history}
        style={s.history}
        contentContainerStyle={s.historyContent}
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            accessibilityLabel={`Loading ${title}`}
            onRefresh={() => void refresh()}
            tintColor={colors.primary}
          />
        }
        onLayout={restoreScroll}
        keyboardShouldPersistTaps="handled"
        onScroll={(event) => {
          if (chat.loading) return;
          const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
          scrollOffset.current = contentOffset.y;
          atBottom.current = contentOffset.y + layoutMeasurement.height >= contentSize.height - 32;
          stateRef.current.viewport = { offset: scrollOffset.current, atBottom: atBottom.current };
        }}
        scrollEventThrottle={100}
        onContentSizeChange={restoreScroll}
      >
        {chat.loading && !refreshing ? (
          <View style={s.empty}>
            <ActivityIndicator color={colors.primary} accessibilityLabel={`Loading ${title}`} />
          </View>
        ) : null}
        {!chat.loading && !chat.error && !chat.messages.length ? (
          <View style={s.empty}>
            <Text style={s.caption}>{emptyText}</Text>
          </View>
        ) : null}
        {chat.messages.map((message, index) => {
          const own = message.senderId === userId;
          const previous = chat.messages[index - 1];
          const next = chat.messages[index + 1];
          const grouped =
            !!previous &&
            previous.senderId === message.senderId &&
            Math.abs(Date.parse(message.createdAt) - Date.parse(previous.createdAt)) < 5 * 60_000;
          const followed =
            !!next &&
            next.senderId === message.senderId &&
            Math.abs(Date.parse(next.createdAt) - Date.parse(message.createdAt)) < 5 * 60_000;
          const name =
            message.senderName ||
            (message.senderUsername ? `@${message.senderUsername}` : 'WTW member');
          return (
            <View
              key={message.id}
              style={[s.message, own && s.own, { marginTop: grouped ? 3 : space.md }]}
            >
              {group && !own ? (
                <View style={s.senderAvatar}>
                  {!grouped ? (
                    <SocialIdentity
                      name={name}
                      uri={message.senderAvatarUrl}
                      userId={message.senderId}
                      avatarRef={message.senderAvatarRef}
                      size={28}
                    />
                  ) : null}
                </View>
              ) : null}
              <View style={s.messageContent}>
                {group && !own && !grouped ? <Text style={s.sender}>{name}</Text> : null}
                <View
                  accessible
                  accessibilityLabel={`${own ? 'You' : name}, ${timeAgo(message.createdAt)}: ${message.body}`}
                  style={[s.bubble, own ? s.outgoing : s.incoming]}
                >
                  <Text style={s.body} selectable>
                    {message.body}
                  </Text>
                </View>
                {!followed ? (
                  <Text style={[s.timestamp, own && s.ownTime]}>{timeAgo(message.createdAt)}</Text>
                ) : null}
              </View>
              {!own ? (
                <Pressable
                  onPress={() => setFlagged({ message, name })}
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
      </ScrollView>
      {error ? (
        <View style={s.notice}>
          <ErrorState variant="banner" message={error} />
        </View>
      ) : null}
      <View style={s.composer}>
        <View style={s.inputWrap}>
          <TextInput
            style={[s.input, { height: inputHeight }]}
            value={body}
            onChangeText={(value) => {
              stateRef.current.body = value;
              setBody(value);
            }}
            multiline
            onContentSizeChange={(event) =>
              setInputHeight(
                Math.max(
                  MIN_TARGET,
                  Math.min(140, Math.ceil(event.nativeEvent.contentSize.height)),
                ),
              )
            }
            placeholder={placeholder}
            placeholderTextColor={colors.muted}
            accessibilityLabel={inputLabel}
            accessibilityHint={`Maximum ${MESSAGE_MAX} characters`}
            maxLength={MESSAGE_MAX * 2}
            editable={!chat.unavailable}
            underlineColorAndroid={colors.transparent}
            scrollEnabled={inputHeight >= 140}
          />
          {[...body.trim()].length > MESSAGE_MAX - 100 ? (
            <Text style={s.counter}>
              {[...body.trim()].length}/{MESSAGE_MAX}
            </Text>
          ) : null}
        </View>
        <Button
          label=""
          icon="arrow-up"
          size="compact"
          accessibilityLabel="Send message"
          loading={busy}
          disabled={!body.trim() || chat.unavailable}
          onPress={() => void send()}
          style={s.send}
        />
      </View>
      {flagged ? (
        <SafetySheet
          onClose={() => setFlagged(null)}
          userId={flagged.message.senderId}
          name={flagged.name}
          target={{ kind: reportKind, id: flagged.message.id }}
          onBlocked={() => void chat.refresh()}
        />
      ) : null}
    </View>
  );
}
const s = StyleSheet.create({
  options: {
    minWidth: MIN_TARGET,
    minHeight: MIN_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notice: { marginHorizontal: space.md },
  context: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.muted,
    textAlign: 'center',
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
  },
  thread: { flex: 1, minHeight: 0 },
  caption: { fontSize: 14, lineHeight: 21, color: colors.muted, textAlign: 'center' },
  body: { fontSize: 17, lineHeight: 24, color: colors.text },
  history: { flex: 1, minHeight: 0 },
  historyContent: {
    flexGrow: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: space.md,
    paddingVertical: space.lg,
  },
  empty: { flex: 1, justifyContent: 'center', paddingHorizontal: space.xl },
  message: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    alignSelf: 'flex-start',
    maxWidth: '86%',
    gap: space.sm,
  },
  own: { alignSelf: 'flex-end' },
  senderAvatar: { width: 28, alignSelf: 'flex-start', paddingTop: space.xs },
  messageContent: { flexShrink: 1, gap: 3 },
  sender: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
    color: colors.muted,
    paddingLeft: space.md,
  },
  bubble: { paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: 18 },
  incoming: { backgroundColor: messageTheme.incoming, borderBottomLeftRadius: 5 },
  outgoing: { backgroundColor: messageTheme.outgoing, borderBottomRightRadius: 5 },
  timestamp: { fontSize: 11, lineHeight: 16, color: colors.muted, paddingHorizontal: space.xs },
  ownTime: { textAlign: 'right' },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm,
    padding: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  inputWrap: { flex: 1, backgroundColor: colors.card, borderRadius: radius.lg },
  input: {
    fontSize: 17,
    lineHeight: 24,
    color: colors.text,
    minHeight: MIN_TARGET,
    maxHeight: 140,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    textAlignVertical: 'top',
  },
  counter: {
    fontSize: 11,
    lineHeight: 16,
    color: colors.muted,
    textAlign: 'right',
    paddingHorizontal: space.md,
    paddingBottom: space.xs,
  },
  send: { width: MIN_TARGET, borderRadius: radius.pill },
});
