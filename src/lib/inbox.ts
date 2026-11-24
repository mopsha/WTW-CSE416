// Context comes from the authorized Activity projection; push copy stays generic.
import { notificationText, type NotificationRow } from '@shared/api/notify.ts';

import { routeForNotification } from './notify';
import { timeAgo } from './time';

export function inboxText(n: Pick<NotificationRow, 'type' | 'payload' | 'activity'>): {
  title: string;
  body: string;
} {
  const fallback = notificationText(n.type, n.payload);
  const details = n.activity;
  const actor = details?.actorName?.trim();
  const person = actor || 'Someone';
  const group = details?.groupName;
  const hang = details?.hangName;
  const reason = n.payload?.reason;
  const cancelReason = typeof reason === 'string' && reason ? `“${reason}”` : '';
  if (!details) {
    return cancelReason ? { ...fallback, body: `${fallback.body} ${cancelReason}` } : fallback;
  }

  switch (n.type) {
    case 'friend_request':
      return { title: `${person} sent you a friend request.`, body: '' };
    case 'friend_accepted':
      return { title: `${person} accepted your friend request.`, body: '' };
    case 'group_invite':
      return { title: `${person} invited you to ${group || 'a group'}.`, body: '' };
    case 'hang_invite':
      return { title: `${person} invited you to ${hang || 'a Hang'}.`, body: '' };
    case 'hang_rsvp': {
      const count = details.replyCount ?? 0;
      if (!count || !details.replyStatus) return fallback;
      const subject =
        count === 1
          ? person
          : actor
            ? `${actor} and ${count - 1} ${count === 2 ? 'other' : 'others'}`
            : `${count} people`;
      if (details.replyStatus === 'cant') {
        return {
          title: `${count === 1 ? 'One person' : `${count} people`} can’t make it to ${hang || 'your Hang'}.`,
          body: '',
        };
      }
      const reply = details.replyStatus === 'down' ? 'Down' : 'Maybe';
      const other = details.otherReplyCount ?? 0;
      return {
        title: `${subject} ${count === 1 ? 'is' : 'are'} ${reply} for ${hang || 'your Hang'}.`,
        body: other ? `${other} other ${other === 1 ? 'response' : 'responses'}.` : '',
      };
    }
    case 'pick_started':
      return {
        title: actor
          ? `${actor} started ${group ? `your ${group} Pick` : 'your Pick'}. It’s ready to swipe.`
          : group
            ? `Your ${group} Pick is ready to swipe.`
            : 'Your Pick is ready to swipe.',
        body: '',
      };
    case 'vote_needed':
      return {
        title: group ? `Voting opened for your ${group} Pick.` : 'Voting opened for your Pick.',
        body: '',
      };
    case 'winner_decided':
      return {
        title: details.winnerName
          ? `Your group picked ${details.winnerName}!`
          : 'Your group picked a winner!',
        body: '',
      };
    case 'pick_canceled':
      return {
        title: `${actor || 'The host'} canceled ${group ? `your ${group} Pick` : 'a Pick'}.`,
        body: cancelReason,
      };
    case 'direct_message':
      return { title: `${person} sent you a message.`, body: '' };
    case 'group_message':
      return { title: `${person} sent a message in ${group || 'your group'}.`, body: '' };
    default:
      return fallback;
  }
}

/** The Pick this row opens; null for a row about no Pick, which isn't tappable. */
export function inboxRoute(
  n: Pick<NotificationRow, 'pickId'> &
    Partial<Pick<NotificationRow, 'type' | 'payload' | 'activity'>>,
): string | null {
  return routeForNotification({
    pickId: n.pickId,
    actorId: n.activity?.actorId,
    hangId: n.payload?.hangId,
    type: n.type,
    groupId: n.payload?.groupId,
    conversationId: n.payload?.conversationId,
  });
}

/** What a screen reader says, since the unread dot and bold title are visual only. */
export function inboxLabel(n: NotificationRow, now: Date = new Date()): string {
  const { title, body } = inboxText(n);
  const sentence = /[.!?]$/.test(title) ? title : `${title}.`;
  return [
    n.readAt ? '' : 'Unread.',
    sentence,
    body,
    `${timeAgo(n.activityAt ?? n.createdAt, now)}.`,
  ]
    .filter(Boolean)
    .join(' ');
}

/** Badge text: nothing at zero, and it never grows past "9+". */
export function badgeText(unread: number): string | null {
  if (unread <= 0) return null;
  return unread > 9 ? '9+' : String(unread);
}
