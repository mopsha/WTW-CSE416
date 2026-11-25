import { auth } from '@/lib/auth';
import { mockAuth } from '@/lib/mock/auth';
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
// Supabase's answer when shouldCreateUser is false and it won't send a code, for example
// because nobody has that email.
const otpDisabled = { code: 'otp_disabled', status: 422, message: 'Signups not allowed for otp' };
const COULD_NOT_SEND =
  'Couldn’t send a sign-in code for that email. Check the address, try your usual sign-in method, or choose Sign Up.';

test('a login Supabase will not send a code for points to other ways in', async () => {
  mockOtp.mockResolvedValue({ error: otpDisabled });
  await expect(auth.sendCode('nobody@example.com', 'login')).rejects.toThrow(COULD_NOT_SEND);
});
test('the mock auth uses the same wording', async () => {
  await expect(mockAuth.sendCode('nobody@example.com', 'login')).rejects.toThrow(COULD_NOT_SEND);
});
test('unrelated login errors keep their own message', async () => {
  mockOtp.mockResolvedValue({
    error: { code: 'unexpected_failure', status: 500, message: 'Error sending email' },
  });
  await expect(auth.sendCode('a@example.com', 'login')).rejects.toThrow('Error sending email');
});
test('sign-up mode does not use the login message', async () => {
  mockOtp.mockResolvedValue({ error: otpDisabled });
  await expect(auth.sendCode('new@example.com', 'signup')).rejects.toThrow(otpDisabled.message);
});
