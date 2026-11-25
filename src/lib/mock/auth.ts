import { clearPendingProfile } from '../pendingProfile';
import {
  accountChanged,
  AuthError,
  type AuthService,
  type AuthSession,
  type AuthMode,
} from '../authTypes';

export const MOCK_CODE = '123456';
export const MOCK_USER_ID = 'mock-user';
export const MOCK_ACCESS_TOKEN = 'mock-access-token';
export const MOCK_EXISTING_EMAIL = 'demo@wtw.test';

let session: AuthSession | null = null;
let attempt: { email: string; mode: AuthMode } | null = null;
const listeners = new Set<(s: AuthSession | null) => void>();
// The mock remains a single fixture user ID, with per-email identity/preferences snapshots.
// Lazy module reads avoid the existing store -> auth module initialization cycle.
function loadStore(): typeof import('./store') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('./store');
}
function loadProfiles(): typeof import('./userProfiles') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('./userProfiles');
}
type Snapshot = {
  profile: typeof import('./store').mockProfile;
  details: ReturnType<typeof import('./userProfiles').mockUserProfiles.get>;
  birthday: ReturnType<typeof import('./userProfiles').mockBirthdays.get>;
};
const clone = <T>(value: T): T =>
  value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
const deleted = new Set<string>();
export function forgetMockAccount() {
  if (session?.user.email) {
    deleted.add(session.user.email);
    accounts.delete(session.user.email);
  }
}
const accounts = new Map<string, Snapshot | null>([[MOCK_EXISTING_EMAIL, null]]);
/** Demo passwords, set on the welcome screen. The demo account's is "password". */
const passwords = new Map<string, string>([[MOCK_EXISTING_EMAIL, 'password']]);
export function mockUsernameTaken(username: string): boolean {
  return [...accounts].some(
    ([email, snapshot]) =>
      email !== session?.user.email &&
      (snapshot?.details?.username ?? (email === MOCK_EXISTING_EMAIL ? 'demo' : null)) === username,
  );
}
async function saveCurrent() {
  if (!session || deleted.has(session.user.email!)) return;
  const { mockProfile } = loadStore();
  const { mockUserProfiles, mockBirthdays } = loadProfiles();
  accounts.set(session.user.email!, {
    profile: clone(mockProfile),
    details: clone(mockUserProfiles.get(MOCK_USER_ID)),
    birthday: clone(mockBirthdays.get(MOCK_USER_ID)),
  });
}
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
  async sendCode(raw, mode = 'login') {
    const email = raw.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new AuthError('invalid_email', 'That email address doesn’t look right.');
    if (mode === 'login' && !accounts.has(email))
      throw new AuthError(
        'unknown',
        'No account uses that email. Check the spelling, or choose Sign Up.',
      );
    attempt = { email, mode };
  },
  async verifyCode(raw, code) {
    const email = raw.trim().toLowerCase();
    if (
      code !== MOCK_CODE ||
      (!accounts.has(email) && !(attempt?.email === email && attempt.mode === 'signup'))
    )
      throw new AuthError('invalid_code', 'That code is wrong or has expired.');
    return enter(email);
  },
  async signInWithPassword(identifier, password) {
    const id = identifier.trim().toLowerCase();
    // An email, or the username saved with an account (the demo account is "demo").
    const email = id.includes('@')
      ? id
      : ([...accounts].find(([, a]) => a?.details?.username === id)?.[0] ??
        (id === 'demo' ? MOCK_EXISTING_EMAIL : undefined));
    if (!email || !passwords.has(email) || passwords.get(email) !== password)
      throw new AuthError('invalid_code', 'Wrong username or password.');
    return enter(email);
  },
  async requestPasswordCode(userId) {
    if (session?.user.id !== userId) throw accountChanged();
  },
  async setPassword(password, { userId }) {
    if (!session?.user.email) throw new AuthError('unknown', 'Sign in first.');
    if (session.user.id !== userId) throw accountChanged();
    if (password.length < 8)
      throw new AuthError('unknown', 'Pick a stronger password (at least 8 characters).');
    passwords.set(session.user.email, password);
  },
  async signInWithApple() {
    throw new AuthError('unknown', 'Sign in with Apple isn’t available in demo mode.');
  },
  async signInWithGoogle() {
    throw new AuthError('unknown', 'Sign in with Google isn’t available in demo mode.');
  },
  async signOut() {
    await clearPendingProfile();
    await saveCurrent();
    setSession(null);
  },
};

/** Loads (or creates) a demo account and signs it in. */
async function enter(email: string): Promise<AuthSession> {
  {
    await saveCurrent();
    const { mockProfile, resetMockProfile } = loadStore();
    const { mockUserProfiles, mockBirthdays, resetOwnMockUserProfile } = loadProfiles();
    const saved = accounts.get(email);
    resetMockProfile();
    resetOwnMockUserProfile();
    if (saved) {
      Object.assign(mockProfile, clone(saved.profile));
      if (saved.details) mockUserProfiles.set(MOCK_USER_ID, clone(saved.details));
      if (saved.birthday) mockBirthdays.set(MOCK_USER_ID, clone(saved.birthday));
    } else if (email === MOCK_EXISTING_EMAIL) {
      // Returning demo user exercises the direct-to-app login path.
      Object.assign(mockProfile, { displayName: 'Demo', optionalSetupPending: false });
      mockUserProfiles.set(MOCK_USER_ID, {
        username: 'demo',
        favoriteCuisine: null,
        favoriteActivity: null,
        shareMetadata: false,
      });
    }
    if (!saved && email !== MOCK_EXISTING_EMAIL) {
      mockProfile.birthdayRequired = false;
      mockProfile.birthdaySetupRequired = false;
    }
    deleted.delete(email);
    accounts.set(email, {
      profile: clone(mockProfile),
      details: clone(mockUserProfiles.get(MOCK_USER_ID)),
      birthday: clone(mockBirthdays.get(MOCK_USER_ID)),
    });
    attempt = null;
    const next = { accessToken: MOCK_ACCESS_TOKEN, user: { id: MOCK_USER_ID, email } };
    setSession(next);
    return next;
  }
}
