import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { colors, ErrorState, Screen } from '@/components';
import { HangResponse } from '@/components/HangCard';
import { useAuth } from '@/hooks/useAuth';
import { usePrivateRefresh } from '@/hooks/usePrivateRefresh';
import { api } from '@/lib/api';
import { isAccessDenied, messageOf } from '@/lib/errors';
import { mutationStamp } from '@/lib/optimisticChoice';
import type { HangPost } from '@shared/api/hang.ts';

export default function HangScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const userId = useAuth().session?.user.id;
  return <HangDetail key={JSON.stringify([id, userId])} id={id} userId={userId} />;
}

const unavailable = { message: 'This Hang is no longer available to you.', retryable: false };

function HangDetail({ id, userId }: { id?: string; userId?: string }) {
  const latest = useRef(0);
  const [result, setResult] = useState<
    | { post: HangPost; stamp: number; refreshError?: string }
    | { message: string; retryable: boolean }
    | null
  >(null);
  const clear = useCallback(() => {
    latest.current++;
    setResult(null);
  }, []);
  const load = useCallback(async () => {
    if (!id || !userId) return;
    const request = ++latest.current;
    const stamp = mutationStamp();
    try {
      const post = await api.getHangPost(id, userId);
      if (request === latest.current)
        setResult(Date.parse(post.expiresAt) <= Date.now() ? unavailable : { post, stamp });
    } catch (error) {
      if (request !== latest.current) return;
      if (isAccessDenied(error) || Number((error as { status?: number } | null)?.status) === 410) {
        setResult(unavailable);
      } else {
        const message = messageOf(error);
        setResult((previous) => {
          if (!previous || !('post' in previous)) return { message, retryable: true };
          if (Date.parse(previous.post.expiresAt) <= Date.now()) return unavailable;
          return { ...previous, refreshError: message };
        });
      }
    }
  }, [id, userId]);
  usePrivateRefresh(load, clear);

  const expiresAt = result && 'post' in result ? result.post.expiresAt : null;
  useEffect(() => {
    if (!expiresAt) return;
    const timer = setTimeout(
      () => {
        setResult((previous) =>
          previous && 'post' in previous && previous.post.expiresAt === expiresAt
            ? unavailable
            : previous,
        );
      },
      Math.max(0, Date.parse(expiresAt) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [expiresAt]);

  return (
    <Screen title="Hang" back>
      {!id || !userId ? (
        <ErrorState message={unavailable.message} />
      ) : !result ? (
        <ActivityIndicator color={colors.muted} accessibilityLabel="Loading Hang" />
      ) : 'message' in result ? (
        <ErrorState
          message={result.message}
          onRetry={result.retryable ? () => void load() : undefined}
        />
      ) : (
        <>
          <HangResponse
            post={result.post}
            stamp={result.stamp}
            userId={userId}
            singlePost
            onStart={() =>
              router.push({
                pathname: '/pick/new',
                params: { hangId: result.post.id, hangActivity: result.post.activity },
              })
            }
          />
          {result.refreshError ? (
            <ErrorState message={result.refreshError} onRetry={() => void load()} />
          ) : null}
        </>
      )}
    </Screen>
  );
}
