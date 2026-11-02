import { useFocusEffect } from 'expo-router';
import type { GroupIdea, GroupIdeaInput } from '@shared/api/groupIdeas.ts';
import { parseGroupIdea } from '@shared/api/groupIdeas.ts';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';
import { api } from '@/lib/api';
import type { GroupDetail } from '@/lib/groups';
import { confirmAction } from '@/lib/confirm';
import { messageOf } from '@/lib/errors';
import { Button, Card, Chips, ErrorState } from '@/components';
import { ListRow, SectionHeading, Sheet } from './TabUi';
import { colors, MIN_TARGET, radius, space, type } from './theme';

const blank: GroupIdeaInput = { name: '', category: 'activity', description: '', locationText: '' };
/** Future possibilities for this group. Saving an idea never creates or alters a Pick. */
export function GroupIdeas({ group, userId }: { group: GroupDetail; userId: string }) {
  const { id: groupId, ownerId } = group;
  const [ideas, setIdeas] = useState<GroupIdea[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<GroupIdea | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<GroupIdeaInput>(blank);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setIdeas((await api.listGroupIdeas(groupId)).ideas);
    } catch (e) {
      setIdeas([]);
      setSelected(null);
      setEditing(false);
      setError(messageOf(e));
    } finally {
      setLoading(false);
    }
  }, [groupId]);
  useFocusEffect(
    useCallback(() => {
      if (group.members.some((member) => member.userId === userId)) void load();
    }, [load, group, userId]),
  );
  const close = () => {
    if (!pending.current) {
      setSelected(null);
      setEditing(false);
      setFormError(null);
    }
  };
  const save = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setFormError(null);
    try {
      const input = parseGroupIdea(form);
      if (selected) await api.updateGroupIdea(groupId, selected.id, input);
      else await api.createGroupIdea(groupId, input);
      setEditing(false);
      setSelected(null);
      await load();
    } catch (e) {
      setFormError(messageOf(e));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!selected || pending.current) return;
    if (
      !(await confirmAction({
        title: 'Delete idea?',
        message: `Remove “${selected.name}” from this group?`,
        confirmLabel: 'Delete',
        destructive: true,
      }))
    )
      return;
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setFormError(null);
    try {
      await api.deleteGroupIdea(groupId, selected.id);
      setSelected(null);
      await load();
    } catch (e) {
      setFormError(messageOf(e));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <View style={s.section}>
      <SectionHeading
        title="Group Ideas"
        right={
          <Button
            label="Add idea"
            variant="link"
            disabled={loading || busy || !!error}
            onPress={() => {
              setSelected(null);
              setForm(blank);
              setFormError(null);
              setEditing(true);
            }}
          />
        }
      />
      <Text style={s.caption}>Things your group might want to do sometime.</Text>
      {error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : loading ? (
        <ActivityIndicator color={colors.primary} accessibilityLabel="Loading group ideas" />
      ) : ideas.length ? (
        <Card>
          {ideas.map((idea) => (
            <ListRow
              key={idea.id}
              title={idea.name}
              subtitle={`${idea.category === 'food' ? 'Food' : 'Activity'}${idea.locationText ? ` · ${idea.locationText}` : ''}`}
              onPress={() => {
                setFormError(null);
                setSelected(idea);
              }}
            />
          ))}
        </Card>
      ) : (
        <Card>
          <Text style={s.caption}>No ideas yet. Add something you’d like to do together.</Text>
        </Card>
      )}
      <Sheet
        visible={editing || selected !== null}
        title={
          editing ? (selected ? 'Edit idea' : 'New group idea') : (selected?.name ?? 'Group idea')
        }
        onClose={close}
      >
        {formError ? <ErrorState message={formError} /> : null}
        {editing ? (
          <View style={s.section}>
            <Text style={s.label}>Name</Text>
            <TextInput
              style={s.input}
              value={form.name}
              onChangeText={(name) => setForm((f) => ({ ...f, name }))}
              accessibilityLabel="Idea name"
              placeholder="Catan at John’s house"
              placeholderTextColor={colors.muted}
              editable={!busy}
            />
            <Chips
              accessibilityLabel="Idea category"
              options={[
                { value: 'activity', label: 'Activity' },
                { value: 'food', label: 'Food' },
              ]}
              value={form.category}
              onChange={(category) => {
                if (!busy) setForm((f) => ({ ...f, category }));
              }}
            />
            <Text style={s.label}>Description (optional)</Text>
            <TextInput
              style={[s.input, s.multiline]}
              value={form.description ?? ''}
              onChangeText={(description) => setForm((f) => ({ ...f, description }))}
              multiline
              accessibilityLabel="Idea description"
              placeholder="What did you have in mind?"
              placeholderTextColor={colors.muted}
              editable={!busy}
            />
            <Text style={s.label}>Location (optional)</Text>
            <TextInput
              style={s.input}
              value={form.locationText ?? ''}
              onChangeText={(locationText) => setForm((f) => ({ ...f, locationText }))}
              accessibilityLabel="Idea location"
              placeholder="A place or meeting spot"
              placeholderTextColor={colors.muted}
              editable={!busy}
            />
            <Text style={s.caption}>
              Name: up to 60 characters. Description and location: up to 200 each.
            </Text>
            <Button label="Save idea" loading={busy} onPress={() => void save()} />
            <Button label="Cancel" variant="secondary" disabled={busy} onPress={close} />
          </View>
        ) : selected ? (
          <View style={s.section}>
            <Text style={s.label}>{selected.category === 'food' ? 'Food' : 'Activity'}</Text>
            {selected.description ? <Text style={s.body}>{selected.description}</Text> : null}
            {selected.locationText ? <Text style={s.body}>{selected.locationText}</Text> : null}
            <Text style={s.caption}>An idea for the future. Nothing is scheduled yet.</Text>
            {selected.createdBy === userId ? (
              <Button
                label="Edit idea"
                variant="secondary"
                disabled={busy}
                onPress={() => {
                  setForm(selected);
                  setEditing(true);
                }}
              />
            ) : null}
            {selected.createdBy === userId || ownerId === userId ? (
              <Button
                label="Delete idea"
                variant="danger"
                loading={busy}
                onPress={() => void remove()}
              />
            ) : null}
          </View>
        ) : null}
      </Sheet>
    </View>
  );
}
const s = StyleSheet.create({
  section: { gap: space.md },
  caption: { ...type.caption, color: colors.muted },
  label: { ...type.body, color: colors.text },
  body: { ...type.body, color: colors.text },
  input: {
    ...type.body,
    color: colors.text,
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.md,
    minHeight: MIN_TARGET,
  },
  multiline: { minHeight: 100, textAlignVertical: 'top' },
});
