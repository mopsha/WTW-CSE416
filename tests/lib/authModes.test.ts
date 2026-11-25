import { auth } from '@/lib/auth';
const mockOtp = jest.fn();
jest.mock('@/lib/config', () => ({ USE_MOCK: false }));
jest.mock('@/lib/supabase', () => ({ getSupabase: () => ({ auth: { signInWithOtp: mockOtp } }) }));
beforeEach(() => mockOtp.mockReset().mockResolvedValue({ error: null }));
test('login explicitly prevents creating an account, including the safe default', async () => {
  await auth.sendCode('existing@example.com', 'login');
  await auth.sendCode('existing@example.com');
  expect(mockOtp.mock.calls).toEqual([
    [{ email: 'existing@example.com', options: { shouldCreateUser: false } }],
    [{ email: 'existing@example.com', options: { shouldCreateUser: false } }],
  ]);
});
test('only explicit signup permits account creation', async () => {
  await auth.sendCode('new@example.com', 'signup');
  expect(mockOtp).toHaveBeenCalledWith({
    email: 'new@example.com',
    options: { shouldCreateUser: true },
  });
});
test('provider rate limiting still surfaces to the caller', async () => {
  mockOtp.mockResolvedValue({ error: { status: 429, message: 'limit' } });
  await expect(auth.sendCode('a@example.com', 'signup')).rejects.toMatchObject({
    code: 'rate_limited',
  });
});
test('logging in with an email that has no account points to Sign Up', async () => {
  // Supabase's answer when shouldCreateUser is false and nobody has that email.
  mockOtp.mockResolvedValue({
    error: { code: 'otp_disabled', status: 422, message: 'Signups not allowed for otp' },
  });
  await expect(auth.sendCode('nobody@example.com', 'login')).rejects.toThrow(
    /No account uses that email.*Sign Up/,
  );
});
