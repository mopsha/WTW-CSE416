// Invite links (Razin, M4): wtw://i/TOKEN. The token is 128 random bits, base64url without
// padding: 22 characters. Same rule as invite_links.token in 0014_invites_safety.sql; the
// app's deep-link screen uses it too.

const INVITE_TOKEN = /^[A-Za-z0-9_-]{22}$/;

export function parseInviteToken(input: string): string | null {
  const token = input.trim();
  return INVITE_TOKEN.test(token) ? token : null;
}

export function inviteUrl(token: string): string {
  return `wtw://i/${token}`;
}
