export interface AuthUser {
  id: string;
  email: string | null;
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
  /** Only the App Store review account has a password. */
  signInWithPassword(email: string, password: string): Promise<AuthSession>;
  signOut(): Promise<void>;
}
