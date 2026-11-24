export interface AuthUser {
  id: string;
  email: string | null;
  /** How this session signed in: 'email' (code or password), 'apple' or 'google'. */
  provider?: string;
  /** A name from Apple or Google, to prefill the welcome screen. */
  name?: string | null;
}

export interface AuthSession {
  user: AuthUser;
  accessToken: string;
}

export type AuthErrorCode =
  | 'invalid_code'
  | 'rate_limited'
  | 'invalid_email'
  /** Changing the password needs a code emailed to me first (requestPasswordCode). */
  | 'reauth_needed'
  /** The signed-in account changed since the screen opened; nothing was changed. */
  | 'account_changed'
  | 'unknown';

export class AuthError extends Error {
  override readonly name = 'AuthError';
  constructor(
    readonly code: AuthErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export const accountChanged = () =>
  new AuthError(
    'account_changed',
    'You’re signed in to a different account now. Open this screen again to change its password.',
  );

export type AuthMode = 'login' | 'signup';

export interface AuthService {
  getSession(): Promise<AuthSession | null>;
  /** Calls `listener` whenever the session changes. Returns an unsubscribe function. */
  onChange(listener: (session: AuthSession | null) => void): () => void;
  /** Only explicit signup may create an account. Defaults to login. */
  sendCode(email: string, mode?: AuthMode): Promise<void>;
  verifyCode(email: string, code: string): Promise<AuthSession>;
  /** Log in with a username or an email, plus password (docs/sign-in.md). */
  signInWithPassword(identifier: string, password: string): Promise<AuthSession>;
  /**
   * Sets my password (welcome screen, Settings → Password). Throws 'reauth_needed' when the
   * project requires a recent proof: send requestPasswordCode(), then retry with that code.
   * `userId` is the account the screen was opened for: if a different one is signed in now,
   * it throws 'account_changed' and changes nothing.
   */
  setPassword(password: string, opts: { userId: string; code?: string }): Promise<void>;
  /** Emails me a code that confirms a password change (same `userId` check). */
  requestPasswordCode(userId: string): Promise<void>;
  /** Native Sign in with Apple / Google. Null when the user cancels. */
  signInWithApple(): Promise<AuthSession | null>;
  signInWithGoogle(): Promise<AuthSession | null>;
  signOut(): Promise<void>;
}
