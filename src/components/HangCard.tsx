import { useOptimisticChoice } from '@/hooks/useOptimisticChoice';
import { usePrivateRefresh } from '@/hooks/usePrivateRefresh';
import { OptimisticChoice, mutationStamp } from '@/lib/optimisticChoice';
import { canRsvpHang, projectHangRsvp } from '@/lib/optimisticRsvp';
import { useMotionPreference } from '@/hooks/useMotionPreference';
import { HangPlanComposer, type HangSendRecovery } from './HangPlanComposer';
import { picksTheme } from './theme';
import { HangInvitation } from './picks/HangInvitation';
import { router } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { isAccessDenied, messageOf } from '@/lib/errors';
import type { HangPost, HangStatus } from '@shared/api/hang.ts';
import { Button, colors, ErrorState, radius, space, type } from './index';

export function HangCard() {
  const userId = useAuth().session?.user.id;
  return <HangFeed key={userId ?? 'signed-out'} userId={userId} />;
}
function HangFeed({ userId }: { userId: string | undefined }) {
  const reduceMotion = useMotionPreference();
  const [now, setNow] = useState(() => Date.now());
  const [compose, setCompose] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [recovery, setRecovery] = useState<HangSendRecovery | null>(null);
  const closeComposer = () => {
    if (!savingRef.current) setCompose(false);
  };
  const latest = useRef(0);
  const sentPost = useRef<HangPost | null>(null);
  const [result, setResult] = useState<{
    posts: HangPost[];
    notice: string;
    error?: string;
    stamp: number;
  } | null>(null);
  const clear = useCallback(() => {
    latest.current++;
    setResult(null);
  }, []);
  const reload = useCallback(async () => {
    if (!userId) return;
    const request = ++latest.current;
    const stamp = mutationStamp();
    try {
      const response = await api.getHang(userId);
      if (request === latest.current) {
        const posted = response.posts.find((post) => post.id === sentPost.current?.id);
        const sent = sentPost.current;
        let first = posted;
        if (!first && sent && Date.parse(sent.expiresAt) > Date.now()) {
          try {
            first = await api.getHangPost(sent.id, userId);
          } catch (error) {
            if (!isAccessDenied(error)) first = sent;
          }
        }
        if (request !== latest.current) return;
        setResult({
          ...response,
          posts: first
            ? [first, ...response.posts.filter((post) => post.id !== first.id)]
            : response.posts,
          stamp,
        });
      }
    } catch (error) {
      if (request !== latest.current) return;
      if (isAccessDenied(error))
        setResult({ posts: [], notice: '', error: messageOf(error), stamp });
      else
        setResult((previous) => ({
          posts: previous?.posts ?? [],
          notice: previous?.notice ?? '',
          stamp: previous?.stamp ?? stamp,
          error: messageOf(error),
        }));
    }
  }, [userId]);
  usePrivateRefresh(reload, clear, 30000);
  const current = result;
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
      {current?.notice ? <Text style={styles.muted}>{current.notice}</Text> : null}
      {current?.error ? <ErrorState message={current.error} onRetry={() => void reload()} /> : null}
      <Button
        variant="secondary"
        style={styles.composeAction}
        label="Make a hang plan"
        icon="add"
        onPress={() => setCompose(true)}
      />
      {current?.posts
        .filter((p) => Date.parse(p.expiresAt) > now)
        .map((post) => (
          <HangResponse
            key={post.id}
            post={post}
            userId={userId}
            stamp={current.stamp}
            onStart={() =>
              router.push({
                pathname: '/pick/new',
                params: { hangId: post.id, hangActivity: post.activity },
              })
            }
          />
        ))}
      <Modal
        visible={compose}
        animationType={reduceMotion ? 'none' : 'slide'}
        presentationStyle="pageSheet"
        allowSwipeDismissal={!saving}
        onRequestClose={closeComposer}
      >
        {compose ? (
          <HangPlanComposer
            key={userId}
            onClose={closeComposer}
            recovery={recovery}
            onRecoveryChange={setRecovery}
            onSavingChange={(value) => {
              savingRef.current = value;
              setSaving(value);
            }}
            onCreated={(post) => {
              if (post?.id) {
                sentPost.current = post;
                latest.current++;
                setResult((previous) => ({
                  posts: [post, ...(previous?.posts ?? []).filter((item) => item.id !== post.id)],
                  notice: previous?.notice ?? '',
                  stamp: mutationStamp(),
                }));
              }
              setCompose(false);
              void reload();
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

export function HangResponse(props: HangResponseProps) {
  return <HangResponseContent key={JSON.stringify([props.userId, props.post.id])} {...props} />;
}

interface HangResponseProps {
  post: HangPost;
  stamp: number;
  userId: string | undefined;
  onStart: () => void;
  singlePost?: boolean;
}

function HangResponseContent({
  post,
  stamp,
  userId,
  onStart,
  singlePost = false,
}: HangResponseProps) {
  const read = async () =>
    (!singlePost
      ? (await api.getHang(userId)).posts.find((item) => item.id === post.id)
      : undefined) ?? api.getHangPost(post.id, userId);
  const rsvp = useOptimisticChoice(
    () =>
      new OptimisticChoice<HangPost, HangStatus>(
        {
          read,
          write: async (status, current) => {
            await api.respondHang(post.id, status, userId);
            if (!current()) throw new Error('Screen changed');
          },
          readAfterWrite: true,
          project: projectHangRsvp,
          selected: (value) => value.myStatus!,
          eligible: canRsvpHang,
        },
        post,
      ),
  );
  useLayoutEffect(() => {
    rsvp.choice.accept(post, stamp);
  }, [rsvp.choice, post, stamp]);
  return (
    <>
      {rsvp.error ? (
        <ErrorState message={rsvp.error} onRetry={() => void rsvp.choice.refresh()} />
      ) : null}
      {rsvp.value ? (
        <HangInvitation
          post={rsvp.value}
          userId={userId}
          busy={null}
          singlePost={singlePost}
          disabled={rsvp.uncertain || !canRsvpHang(rsvp.value)}
          pending={rsvp.pending}
          onRespond={(status) => rsvp.choice.choose(status)}
          onStart={() => {
            if (!rsvp.pending && !rsvp.uncertain) onStart();
          }}
        />
      ) : null}
    </>
  );
}
