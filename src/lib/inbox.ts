// What an inbox row says (Mike, M4). Same wording as the push, plus details only the owner may
// see: a lock screen stays generic, but the inbox can show why a Pick was canceled.
import { PUSH_TEXT, type NotificationRow } from '@shared/api/notify.ts';

import { routeForNotification } from './notify';
import { timeAgo } from './time';

export function inboxText(n: Pick<NotificationRow, 'type' | 'payload'>): {
  title: string;
  body: string;
} {
  const { title, body } = PUSH_TEXT[n.type] ?? { title: 'WTW', body: 'Something happened.' };
  const reason = n.payload?.reason;
  return typeof reason === 'string' && reason
    ? { title, body: `${body} “${reason}”` }
    : { title, body };
}

/** The Pick this row opens; null for a row about no Pick, which isn't tappable. */
export function inboxRoute(n: Pick<NotificationRow, 'pickId'>): string | null {
  return routeForNotification({ pickId: n.pickId });
}

/** What a screen reader says, since the unread dot and bold title are visual only. */
export function inboxLabel(n: NotificationRow, now: Date = new Date()): string {
  const { title, body } = inboxText(n);
  return `${n.readAt ? '' : 'Unread. '}${title}. ${body} ${timeAgo(n.createdAt, now)}.`;
}

/** Badge text: nothing at zero, and it never grows past "9+". */
export function badgeText(unread: number): string | null {
  if (unread <= 0) return null;
  return unread > 9 ? '9+' : String(unread);
}
