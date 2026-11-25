import { useLayoutEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Button, Card, colors, ErrorState, space, type } from '@/components';
import { useProfile } from '@/hooks/useProfile';
import {
  contactPickerAvailable,
  contactInvitation,
  createContactRequest,
  nativeSharing,
  shareInvite,
  type InviteIssue,
} from '@/lib/contactInvites';

const messages: Record<InviteIssue, string> = {
  denied: 'Your device didn’t allow access to that selection. You can still share the invite.',
  noPhone: 'That selection has no usable phone number. Choose another contact or share the invite.',
  pickerUnavailable: 'The contact picker couldn’t open. You can still share the invite.',
  textUnavailable: 'Text messaging is unavailable. You can still share the invite.',
};

export function ContactInvite({ onBack }: { onBack(): void }) {
  const { username } = useProfile();
  const { message: body, installedOnly } = contactInvitation(username);
  const contactRequest = useRef<ReturnType<typeof createContactRequest> | null>(null);
  const [busy, setBusy] = useState<'contacts' | 'share' | null>(null);
  const [issue, setIssue] = useState<string>();
  const pending = useRef(false);
  const active = useRef(false);
  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      contactRequest.current?.cancel();
    };
  }, []);

  async function start(action: 'contacts' | 'share') {
    if (pending.current || !active.current) return;
    pending.current = true;
    setBusy(action);
    setIssue(undefined);
    try {
      if (action === 'contacts') {
        const request = createContactRequest();
        contactRequest.current = request;
        const result = await request.run(body);
        if (active.current && result) setIssue(messages[result]);
      } else {
        const opened = await shareInvite(body);
        if (active.current && !opened)
          setIssue('Sharing couldn’t open. Press and hold the invite text to copy it.');
      }
    } finally {
      contactRequest.current = null;
      pending.current = false;
      if (active.current) setBusy(null);
    }
  }

  return (
    <View style={{ gap: space.md }}>
      <Text style={{ ...type.body, color: colors.muted }}>
        {contactPickerAvailable
          ? 'WTW uses only the phone number you choose to address a draft. You review and send it from your messaging app.'
          : 'Contact selection is unavailable here. You can share or copy the invite below.'}
      </Text>
      {installedOnly ? (
        <Text style={{ ...type.body, color: colors.text }}>
          For people who already have WTW installed. This invitation has no install link.
        </Text>
      ) : null}
      <Card>
        <Text style={{ ...type.caption, color: colors.muted }}>Invite message</Text>
        <Text selectable style={{ ...type.body, color: colors.text }}>
          {body}
        </Text>
      </Card>
      {issue ? <ErrorState message={issue} /> : null}
      {contactPickerAvailable ? (
        <>
          <Button
            label={installedOnly ? 'Text a WTW user' : 'Choose a contact to text'}
            icon="person-outline"
            loading={busy === 'contacts'}
            disabled={!!busy}
            onPress={() => void start('contacts')}
          />
          <Text style={{ ...type.caption, color: colors.muted }}>
            If the picker is empty, add a contact with a phone number or share the invite.
          </Text>
        </>
      ) : null}
      {nativeSharing ? (
        <Button
          label={installedOnly ? 'Share with a WTW user' : 'Share invite'}
          icon="share-outline"
          variant={contactPickerAvailable ? 'secondary' : 'primary'}
          loading={busy === 'share'}
          disabled={!!busy}
          onPress={() => void start('share')}
        />
      ) : null}
      <Button label="Back to username search" variant="link" onPress={onBack} />
    </View>
  );
}
