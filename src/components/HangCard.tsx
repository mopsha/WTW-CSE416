import { router, useFocusEffect } from 'expo-router';
import { queries } from '@/lib/queries';
import type { GroupSummary } from '@/lib/groups';
import { useCallback, useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { messageOf } from '@/lib/errors';
import { CUSTOM_TEMPLATES } from '@shared/domain/customPlans.ts';
import type { HangPost } from '@shared/api/hang.ts';
import {
  Button,
  Card,
  Chips,
  colors,
  ErrorState,
  IconButton,
  MIN_TARGET,
  Screen,
  space,
  type,
} from './index';

function Compose({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const userId = useAuth().session?.user.id;
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [audience, setAudience] = useState('all_friends');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (userId)
      void queries
        .listMyGroups(userId)
        .then((g) => {
          if (active) setGroups(g);
        })
        .catch((e) => {
          if (active) setError(`Could not load groups: ${messageOf(e)}`);
        });
    return () => {
      active = false;
    };
  }, [userId]);
  const [activity, setActivity] = useState('');
  const [hours, setHours] = useState(1);
  const [busy, setBusy] = useState(false);
  return (
    <Screen
      title="Who's down?"
      right={<IconButton icon="close" accessibilityLabel="Close compose" onPress={onClose} />}
    >
      <Text style={styles.muted}>
        Ask your friends who’s down, then make a Pick with the people who are in.
      </Text>
      <Chips
        options={CUSTOM_TEMPLATES.map((value) => ({ value, label: value }))}
        value={activity}
        onChange={setActivity}
        accessibilityLabel="Hang activity templates"
      />
      <Chips
        options={[
          { value: 'all_friends', label: 'All friends' },
          ...groups.map((g) => ({ value: g.id, label: g.name })),
        ]}
        value={audience}
        onChange={setAudience}
        accessibilityLabel="Hang audience"
      />
      <TextInput
        value={activity}
        onChangeText={setActivity}
        maxLength={60}
        placeholder="What do you want to do?"
        placeholderTextColor={colors.muted}
        style={styles.input}
        accessibilityLabel="Hang activity"
      />
      <Chips
        options={[
          { value: 1, label: 'In 1 hour' },
          { value: 3, label: 'In 3 hours' },
          { value: 24, label: 'Tomorrow' },
        ]}
        value={hours}
        onChange={setHours}
        accessibilityLabel="Hang start time"
      />
      {error ? <ErrorState message={error} /> : null}
      <Button
        label="Save hang plan"
        loading={busy}
        disabled={!activity.trim()}
        onPress={() => {
          setBusy(true);
          setError(null);
          const starts = Date.now() + hours * 3600000;
          void api
            .createHang({
              activity,
              audience: audience === 'all_friends' ? 'all_friends' : 'group',
              groupId: audience === 'all_friends' ? null : audience,
              startsAt: new Date(starts).toISOString(),
              expiresAt: new Date(starts + 4 * 3600000).toISOString(),
            })
            .then(onCreated)
            .catch((e) => setError(messageOf(e)))
            .finally(() => setBusy(false));
        }}
      />
    </Screen>
  );
}
export function HangCard() {
  const userId = useAuth().session?.user.id;
  const [now, setNow] = useState(() => Date.now());
  const [compose, setCompose] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    posts: HangPost[];
    notice: string;
    error?: string;
  } | null>(null);
  const key = `${userId}:${retry}`;
  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      setRetry((n) => n + 1);
      const t = setInterval(() => setRetry((n) => n + 1), 30000);
      return () => clearInterval(t);
    }, [userId]),
  );
  const respond = (id: string, status: 'down' | 'maybe' | 'cant') => {
    if (busy) return;
    setBusy(`${id}-${status}`);
    setActionError(null);
    void api
      .respondHang(id, status)
      .then(() => setRetry((n) => n + 1))
      .catch((e) => setActionError(messageOf(e)))
      .finally(() => setBusy(null));
  };
  useEffect(() => {
    let active = true;
    api
      .getHang()
      .then((response) => {
        if (active) setResult({ key, ...response });
      })
      .catch((e) => {
        if (active) setResult({ key, posts: [], notice: '', error: messageOf(e) });
      });
    return () => {
      active = false;
    };
  }, [key]);
  const current = result?.key === key ? result : null;
  useEffect(() => {
    const next = Math.min(
      ...(current?.posts ?? []).map((p) => Date.parse(p.expiresAt)).filter((at) => at > now),
    );
    if (!Number.isFinite(next)) return;
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.max(1, Math.min(next - Date.now(), 86400000)),
    );
    return () => clearTimeout(timer);
  }, [current, now]);
  return (
    <Card>
      <Text style={styles.title}>Who’s down?</Text>
      {!current ? <Text style={styles.muted}>Loading hang plans…</Text> : null}
      {actionError ? <ErrorState message={actionError} /> : null}
      {current?.notice ? <Text style={styles.muted}>{current.notice}</Text> : null}
      {current?.error ? (
        <ErrorState message={current.error} onRetry={() => setRetry((n) => n + 1)} />
      ) : null}
      {current?.posts
        .filter((p) => Date.parse(p.expiresAt) > now)
        .map((post) => (
          <View key={post.id}>
            <Text style={styles.body}>{post.activity}</Text>
            <Text style={styles.muted}>
              {post.authorId === userId ? 'You' : (post.authorName ?? 'A friend')} ·{' '}
              {new Date(post.startsAt).toLocaleString()}
            </Text>
            <Text style={styles.muted}>{post.downCount ?? 0} down</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {(['down', 'maybe', 'cant'] as const).map((status) => (
                <Button
                  key={status}
                  label={status === 'down' ? 'Down' : status === 'maybe' ? 'Maybe' : 'Can’t'}
                  variant={post.myStatus === status ? 'secondary' : 'link'}
                  disabled={busy !== null}
                  loading={busy === `${post.id}-${status}`}
                  onPress={() => respond(post.id, status)}
                />
              ))}
            </View>
            {post.authorId === userId ? (
              <>
                <Text style={styles.muted}>
                  Only people who answer Down join. If you’re not down, one of them hosts.
                </Text>
                <Button
                  label="Let’s Pick"
                  variant="secondary"
                  disabled={!post.downCount || busy !== null}
                  onPress={() =>
                    router.push({
                      pathname: '/pick/new',
                      params: { hangId: post.id, hangActivity: post.activity },
                    })
                  }
                />
              </>
            ) : null}
          </View>
        ))}
      <Button
        variant="secondary"
        label="Make a hang plan"
        icon="add"
        onPress={() => setCompose(true)}
      />
      <Modal
        visible={compose}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setCompose(false)}
      >
        {compose ? (
          <Compose
            key={userId}
            onClose={() => setCompose(false)}
            onCreated={() => {
              setCompose(false);
              setRetry((n) => n + 1);
            }}
          />
        ) : null}
      </Modal>
    </Card>
  );
}
const styles = StyleSheet.create({
  title: { ...type.heading, color: colors.text },
  body: { ...type.body, color: colors.text },
  muted: { ...type.caption, color: colors.muted },
  input: {
    ...type.body,
    minHeight: MIN_TARGET,
    padding: space.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    color: colors.text,
  },
});
