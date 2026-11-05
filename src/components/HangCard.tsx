import { useReducedMotion } from 'react-native-reanimated';
import { HangPlanComposer } from './HangPlanComposer';
import { picksTheme } from './theme';
import { HangInvitation } from './picks/HangInvitation';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { messageOf } from '@/lib/errors';
import type { HangPost } from '@shared/api/hang.ts';
import { Button, colors, ErrorState, radius, space, type } from './index';

export function HangCard() {
  const reduceMotion = useReducedMotion();
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
    <View style={styles.feed}>
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
          <HangInvitation
            key={post.id}
            post={post}
            userId={userId}
            busy={busy}
            onRespond={(status) => respond(post.id, status)}
            onStart={() =>
              router.push({
                pathname: '/pick/new',
                params: { hangId: post.id, hangActivity: post.activity },
              })
            }
          />
        ))}
      <Button
        variant="secondary"
        style={styles.composeAction}
        label="Make a hang plan"
        icon="add"
        onPress={() => setCompose(true)}
      />
      <Modal
        visible={compose}
        animationType={reduceMotion ? 'none' : 'slide'}
        presentationStyle="pageSheet"
        onRequestClose={() => setCompose(false)}
      >
        {compose ? (
          <HangPlanComposer
            key={userId}
            onClose={() => setCompose(false)}
            onCreated={() => {
              setCompose(false);
              setRetry((n) => n + 1);
            }}
          />
        ) : null}
      </Modal>
    </View>
  );
}
const styles = StyleSheet.create({
  feed: { gap: space.md },
  composeAction: { backgroundColor: colors.card, borderWidth: 0, borderRadius: radius.md },
  title: { ...picksTheme.section, color: colors.text },
  body: { ...type.body, color: colors.text },
  muted: { ...type.caption, color: colors.muted },
});
