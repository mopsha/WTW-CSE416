import { clearPendingProfile } from '../pendingProfile';
import { AuthError, type AuthService, type AuthSession, type AuthMode } from '../authTypes';

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
        'Could not send a login code. Check your email or choose Sign Up.',
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
  },
  async signInWithPassword() {
    throw new AuthError('unknown', 'Password sign-in isn’t available in demo mode.');
  },
  async signOut() {
    await clearPendingProfile();
    await saveCurrent();
    setSession(null);
  },
};
