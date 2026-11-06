import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import type { PersonIdentity } from '@shared/api/people.ts';
import { normalizeUsername } from '@shared/api/usernames.ts';
import { api } from '@/lib/api';
import { messageOf } from '@/lib/errors';
import { useSession } from '@/hooks/useAuth';
import { Button, ErrorState } from '../index';
import { SocialIdentity, SocialRow } from './SocialRow';
import { colors, MIN_TARGET, radius, space, type } from '../theme';

export function PersonFriendAction({
  person,
  onChanged,
  onRespond,
}: {
  person: PersonIdentity;
  onChanged(): Promise<void>;
  onRespond?(): void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const latestPerson = useRef(person);
  useEffect(() => {
    latestPerson.current = person;
  }, [person]);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [confirmed, setConfirmed] = useState<{
    person: PersonIdentity;
    relationship: 'requested' | 'friends';
  } | null>(null);
  const relationship = confirmed?.person === person ? confirmed.relationship : person.relationship;
  const label = {
    none: 'Add friend',
    requested: 'Requested',
    incoming: 'Respond',
    friends: 'Friends',
    self: 'You',
  }[relationship];
  async function send() {
    if (pending.current) return;
    if (person.relationship === 'incoming') {
      if (onRespond) onRespond();
      else router.push({ pathname: '/friends', params: { requests: '1' } });
      return;
    }
    if (relationship !== 'none') return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await api.addFriendByUsername(person.username, person.userId);
      if (mounted.current) {
        if (result.relationship)
          setConfirmed({ person: latestPerson.current, relationship: result.relationship });
        try {
          await onChanged();
        } catch {
          /* A failed read cannot undo a confirmed write. */
        }
      }
    } catch (e) {
      if (mounted.current) setError(messageOf(e));
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <View style={{ gap: space.xs }}>
      <Button
        label={label}
        accessibilityLabel={`${label}, @${person.username}`}
        variant="secondary"
        size="compact"
        loading={busy}
        disabled={busy || !['none', 'incoming'].includes(relationship)}
        onPress={() => void send()}
      />
      {error ? (
        <Text accessibilityRole="alert" style={{ ...type.caption, color: colors.danger }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}
export function UsernameFriendSearch({
  onAdded,
  onNavigate,
}: {
  onAdded(): void;
  onNavigate?(target: { kind: 'requests' } | { kind: 'profile'; id: string }): void;
}) {
  const viewer = useSession().user.id;
  const [text, setText] = useState('');
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    people: PersonIdentity[];
    error?: string;
  } | null>(null);
  let query = '';
  try {
    query = normalizeUsername(text, true);
  } catch {
    /* Wait for a complete searchable prefix. */
  }
  const key = `${viewer}:${query}:${retry}`;
  const current = result?.key === key ? result : null;
  useEffect(() => {
    if (!query) return;
    let active = true;
    const timer = setTimeout(() => {
      void api
        .searchPeople(query)
        .then(({ people }) => {
          if (active) setResult({ key, people });
        })
        .catch((e) => {
          if (active) setResult({ key, people: [], error: messageOf(e) });
        });
    }, 350);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, key]);
  return (
    <View style={{ gap: space.md }}>
      <Text style={styles.caption}>Find friends by username.</Text>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="@username"
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        maxLength={25}
        accessibilityLabel="Friend's username"
        style={styles.input}
      />
      {!query ? (
        <Text style={styles.caption}>Enter at least 3 letters, numbers or underscores.</Text>
      ) : null}
      {query && !current ? (
        <ActivityIndicator color={colors.primary} accessibilityLabel="Searching usernames" />
      ) : null}
      {current?.error ? (
        <ErrorState message={current.error} onRetry={() => setRetry((n) => n + 1)} />
      ) : null}
      {current && !current.error && !current.people.length ? (
        <Text style={styles.caption}>No matching usernames.</Text>
      ) : null}
      {current?.people.map((person) => (
        <SocialRow
          key={person.userId}
          title={person.displayName || `@${person.username}`}
          subtitle={`@${person.username}`}
          leading={
            <SocialIdentity
              name={person.displayName || person.username}
              userId={person.userId}
              avatarRef={person.avatarRef}
            />
          }
          onPress={() => {
            if (onNavigate) onNavigate({ kind: 'profile', id: person.userId });
          }}
          actions={
            <PersonFriendAction
              person={person}
              onRespond={() => onNavigate?.({ kind: 'requests' })}
              onChanged={async () => {
                onAdded();
                const { people } = await api.searchPeople(query);
                setResult({ key, people });
              }}
            />
          }
        />
      ))}
    </View>
  );
}
const styles = StyleSheet.create({
  caption: { ...type.caption, color: colors.muted },
  input: {
    ...type.body,
    color: colors.text,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: space.md,
    minHeight: MIN_TARGET,
  },
});
