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

export type AuthErrorCode = 'invalid_code' | 'rate_limited' | 'invalid_email' | 'unknown';

export class AuthError extends Error {
  override readonly name = 'AuthError';
  constructor(
    readonly code: AuthErrorCode,
    message: string,
  ) {
    super(message);
  }
}

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
  /** Sets my password (the welcome screen, after signing up with an emailed code). */
  setPassword(password: string): Promise<void>;
  /** Native Sign in with Apple / Google. Null when the user cancels. */
  signInWithApple(): Promise<AuthSession | null>;
  signInWithGoogle(): Promise<AuthSession | null>;
  signOut(): Promise<void>;
}
