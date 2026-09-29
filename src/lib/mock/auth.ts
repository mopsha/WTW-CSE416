import { AuthError, type AuthService, type AuthSession } from '../authTypes';

/** Mock mode accepts any email with this code. */
export const MOCK_CODE = '123456';
export const MOCK_USER_ID = 'mock-user';
export const MOCK_ACCESS_TOKEN = 'mock-access-token';

let session: AuthSession | null = null;
const listeners = new Set<(s: AuthSession | null) => void>();

function setSession(next: AuthSession | null) {
  session = next;
  for (const l of listeners) l(next);
}

export const mockAuth: AuthService = {
  async getSession() {
    return session;
  },
  onChange(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  async sendCode(email) {
    if (!email.includes('@')) {
      throw new AuthError('invalid_email', 'That email address doesn’t look right.');
    }
  },
  async verifyCode(email, code) {
    await new Promise((r) => setTimeout(r, 300));
    if (code !== MOCK_CODE) {
      throw new AuthError('invalid_code', 'That code is wrong or has expired.');
    }
    const next = { accessToken: MOCK_ACCESS_TOKEN, user: { id: MOCK_USER_ID, email } };
    setSession(next);
    return next;
  },
  async signOut() {
    setSession(null);
  },
};
