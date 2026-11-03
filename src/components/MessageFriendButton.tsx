import { useRef } from 'react';
import { router } from 'expo-router';
import { Button, ErrorState } from '@/components';
import { useAction } from '@/hooks/useAction';
import { api } from '@/lib/api';
/** Eligibility is rechecked by the server even when the profile/list is stale. */
export function MessageFriendButton({ userId }: { userId: string }) {
  const action = useAction();
  const pending = useRef(false);
  return (
    <>
      <Button
        label="Message"
        icon="chatbubble-outline"
        loading={!!action.busy}
        onPress={() => {
          if (pending.current) return;
          pending.current = true;
          void action
            .run('message', async () => {
              const conversation = await api.openDirectConversation(userId);
              router.push({ pathname: '/messages/[id]', params: { id: conversation.id } });
            })
            .finally(() => {
              pending.current = false;
            });
        }}
      />
      {action.error ? <ErrorState variant="banner" message={action.error} /> : null}
    </>
  );
}
