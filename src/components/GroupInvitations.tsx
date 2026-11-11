import { SocialIdentity, SocialRow, SocialSectionTitle } from './friends/SocialRow';
import { radius } from './theme';
import type { GroupInvitation } from '@shared/api/groupInvitations.ts';
import { usePrivateRefresh } from '@/hooks/usePrivateRefresh';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { Button, Card, ErrorState, colors, space, type } from '@/components';
import { api } from '@/lib/api';
import { messageOf } from '@/lib/errors';
import { SectionHeading } from './TabUi';

/** Recipient requests live beside friend requests, without exposing group content early. */
export function GroupInvitations({
  onAccepted,
  refreshing,
  variant = 'default',
  renderContainer,
}: {
  onAccepted: () => void;
  refreshing: boolean;
  variant?: 'default' | 'compact';
  /** Keep private refresh mounted when the caller presents requests in a sheet. */
  renderContainer?: (state: {
    count: number;
    loading: boolean;
    error: string | null;
    content: ReactNode;
  }) => ReactNode;
}) {
  const [invitations, setInvitations] = useState<GroupInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const pending = useRef(false);
  const latest = useRef(0);
  const clear = useCallback(() => {
    latest.current++;
    setInvitations([]);
    setLoading(true);
    setError(null);
  }, []);
  const load = useCallback(async () => {
    if (refreshing) return;
    const request = ++latest.current;
    try {
      const result = await api.listGroupInvitations();
      if (request === latest.current) {
        setInvitations(result.invitations);
        setError(null);
      }
    } catch (e) {
      if (request === latest.current) {
        setInvitations([]);
        setError(messageOf(e));
      }
    } finally {
      if (request === latest.current) setLoading(false);
    }
  }, [refreshing]);
  usePrivateRefresh(load, clear);
  const respond = async (invite: GroupInvitation, decision: 'accepted' | 'declined') => {
    if (pending.current) return;
    pending.current = true;
    setBusy(`${invite.id}:${decision}`);
    setError(null);
    try {
      await api.respondGroupInvitation(invite.id, decision);
      setInvitations((rows) => rows.filter((i) => i.id !== invite.id));
      if (decision === 'accepted') onAccepted();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      pending.current = false;
      setBusy(null);
    }
  };
  const content =
    !loading && !error && !invitations.length ? null : (
      <View style={{ gap: space.md }}>
        {variant === 'compact' ? (
          <SocialSectionTitle title="Group invitations" count={invitations.length} />
        ) : (
          <SectionHeading title="Group invitations" badge={invitations.length} />
        )}
        {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
        {loading ? (
          <ActivityIndicator
            color={colors.primary}
            accessibilityLabel="Loading group invitations"
          />
        ) : null}
        {invitations.map((i) =>
          variant === 'compact' ? (
            <SocialRow
              key={i.id}
              title={i.groupName}
              subtitle={`${i.inviterName ?? 'A friend'} invited you to ${i.groupName}`}
              leading={<SocialIdentity name={i.groupName} group />}
              actions={
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
                  <Button
                    label="Accept"
                    variant="secondary"
                    style={{ borderWidth: 0, borderRadius: radius.sm }}
                    loading={busy === `${i.id}:accepted`}
                    disabled={busy !== null}
                    accessibilityLabel={`Accept invitation to ${i.groupName}`}
                    onPress={() => void respond(i, 'accepted')}
                  />
                  <Button
                    label="Decline"
                    variant="link"
                    loading={busy === `${i.id}:declined`}
                    disabled={busy !== null}
                    accessibilityLabel={`Decline invitation to ${i.groupName}`}
                    onPress={() => void respond(i, 'declined')}
                  />
                </View>
              }
            />
          ) : (
            <Card key={i.id}>
              <Text style={{ ...type.body, color: colors.text }}>
                {i.inviterName ?? 'A friend'} invited you to {i.groupName}
              </Text>
              <View style={{ flexDirection: 'row', gap: space.sm }}>
                <Button
                  label="Accept"
                  variant="secondary"
                  loading={busy === `${i.id}:accepted`}
                  disabled={busy !== null}
                  accessibilityLabel={`Accept invitation to ${i.groupName}`}
                  onPress={() => void respond(i, 'accepted')}
                />
                <Button
                  label="Decline"
                  variant="link"
                  loading={busy === `${i.id}:declined`}
                  disabled={busy !== null}
                  accessibilityLabel={`Decline invitation to ${i.groupName}`}
                  onPress={() => void respond(i, 'declined')}
                />
              </View>
            </Card>
          ),
        )}
      </View>
    );
  return renderContainer
    ? renderContainer({ count: invitations.length, loading, error, content })
    : content;
}
