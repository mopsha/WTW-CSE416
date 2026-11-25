import { requireOptionalNativeModule } from 'expo';
import { Platform, Share } from 'react-native';

type PickResult =
  | { status: 'selected'; number: string }
  | { status: 'cancelled' | 'noPhone' | 'denied' | 'unavailable' };
type ComposeResult = 'opened' | 'closed' | 'cancelled' | 'unavailable';

interface ContactInvitesModule {
  pickPhone(requestId: number): Promise<PickResult>;
  composeText(requestId: number, number: string, message: string): Promise<ComposeResult>;
  cancel?(requestId: number): Promise<void>;
}

export const nativeSharing = Platform.OS === 'ios' || Platform.OS === 'android';
const contacts = nativeSharing
  ? requireOptionalNativeModule<ContactInvitesModule>('ContactInvites')
  : null;
export const contactPickerAvailable = !!contacts;

function publicInstallLink(value?: string): string | null {
  const candidate = value?.trim();
  if (!candidate || !/^https:\/\/[a-z0-9]/i.test(candidate) || /[^\x21-\x7e]|\\/.test(candidate))
    return null;
  try {
    const url = new URL(candidate);
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    // Deployment supplies a verified destination. Reject credentials and local/network literals.
    if (
      url.username ||
      url.password ||
      url.port ||
      !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]*$/.test(host) ||
      /(?:^|\.)example\.(?:com|net|org)$/.test(host) ||
      /\.(?:localhost|local|internal|test|invalid|example|onion|home|lan|corp)$/.test(host)
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}

export function contactInvitation(
  username: string | null,
  installUrl = process.env.EXPO_PUBLIC_WTW_INSTALL_URL,
) {
  const publicLink = publicInstallLink(installUrl);
  const from =
    username && /^[a-z0-9_]{3,24}$/.test(username)
      ? `Find me as @${username} on WTW!`
      : 'Find friends on WTW!';
  const audience = publicLink
    ? `Get WTW: ${publicLink}`
    : 'For people who already have WTW installed.';
  return {
    installedOnly: !publicLink,
    message: [from, audience, 'Open WTW: wtw://friends'].join('\n'),
  };
}

let nextRequestId = 0;

export function createContactRequest() {
  const id = ++nextRequestId;
  let current = true;
  return {
    run: (message: string) => inviteFromContacts(id, message, () => current),
    cancel() {
      current = false;
      void contacts?.cancel?.(id).catch(() => {});
    },
  };
}

export type InviteIssue = 'denied' | 'noPhone' | 'pickerUnavailable' | 'textUnavailable';

async function inviteFromContacts(
  requestId: number,
  message: string,
  isCurrent: () => boolean,
): Promise<InviteIssue | undefined> {
  if (!isCurrent()) return;
  if (!contacts) return 'pickerUnavailable';
  let selection: PickResult;
  try {
    selection = await contacts.pickPhone(requestId);
  } catch {
    return isCurrent() ? 'pickerUnavailable' : undefined;
  }
  if (!isCurrent()) return;
  switch (selection.status) {
    case 'cancelled':
      return;
    case 'unavailable':
      return 'pickerUnavailable';
    case 'denied':
    case 'noPhone':
      return selection.status;
    case 'selected': {
      // Accept one dialable destination. Reject separators that can address multiple recipients.
      const number = selection.number.replace(/[\s().-]/g, '');
      if (!/^\+?[0-9]+$/.test(number)) return 'noPhone';
      try {
        const result = await contacts.composeText(requestId, number, message);
        if (isCurrent() && result === 'unavailable') return 'textUnavailable';
      } catch {
        return isCurrent() ? 'textUnavailable' : undefined;
      }
    }
  }
}

export async function shareInvite(message: string): Promise<boolean> {
  if (!nativeSharing) return false;
  try {
    await Share.share({ message });
    return true;
  } catch {
    return false;
  }
}
