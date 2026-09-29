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

export interface AuthService {
  getSession(): Promise<AuthSession | null>;
  /** Calls `listener` whenever the session changes. Returns an unsubscribe function. */
  onChange(listener: (session: AuthSession | null) => void): () => void;
  /** Email a 6-digit sign-in code (creates the account on first sign-in). */
  sendCode(email: string): Promise<void>;
  verifyCode(email: string, code: string): Promise<AuthSession>;
  signOut(): Promise<void>;
}
