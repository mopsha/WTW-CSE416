# Sign-in (owner: Alan)

Goal: sign up in under a minute, log back in without digging through email, and give every new
user a real-looking username.

## What users see

**Sign-in screen** (`app/sign-in.tsx`)

- **Continue with Apple / Continue with Google** at the top. Each appears only once it's set up
  (see the checklist below), so nothing breaks before then.
- **Log In:** "Username or email" and a password. "Forgot password? Email me a code" falls back
  to the 6-digit emailed code.
- **Sign Up:** email, then a 6-digit code (this proves the email is real), then the welcome
  screen.
- The App Store review account logs in the same way (email + password).

**Welcome screen** (`app/welcome.tsx`, new accounts only)

- **Name:** comes from Apple or Google when available.
- **Username:** suggested from the name ("Alan John" → `alanjohn`) until the user types their
  own. It's checked as they type (`GET /usernames/available`), with a one-tap alternative when
  taken ("Use @alanjohn27"). New usernames must start with a letter; existing ones are kept.
- **Password:** 8+ characters, email sign-ups only. It's saved before the profile, so nobody ends
  up with a profile but no password. Apple and Google accounts don't get a password field.

## How username login works

- An email logs in directly from the app (`supabase.auth.signInWithPassword`).
- A username goes to `POST /auth/password-login`. The server finds that account's email, signs
  in with a throwaway client, and returns only the session tokens; the app calls `setSession`.
  The email never leaves the server.
- Wrong passwords and unknown usernames fail the same way, "Wrong username or password", and
  take about as long (an unknown username still makes a real sign-in call against a dummy
  address). Other failures say what happened (Supabase busy, email not confirmed, or the
  account lookup failing) and don't spend the user's tries: a lookup failure is reported before
  anything is charged, and a sign-in failure refunds exactly the attempt it was charged, in the
  15-minute bucket it was charged to.
- These sign-ins all come from the server's address, so Supabase's per-IP limits can't tell
  users apart. Migration 0057 adds limits per 15 minutes, all checked together:
  - 10 per account per client, so a stranger's junk tries can't lock you out;
  - 20 per client across all accounts, so one password can't be sprayed over every username;
  - 600 overall, a backstop for clients that rotate addresses.
    An attempt is charged to all of them or none: if any limit is reached it's refused and spends
    nothing, so a client that's already blocked can't use up the overall budget and lock others out.
    The client is the edge-reported IP (`cf-connecting-ip`, then `x-real-ip`, then
    `x-forwarded-for`). Subjects are stored hashed, and the sweep deletes buckets older than a
    day (`purge_login_limits`).
- `GET /usernames/available` spends the same lookup quota as people search (30 a minute), so it
  can't be used to list usernames faster than friend search allows.
- **Settings → Password** (`app/settings/password.tsx`) sets or changes the password. It's for
  everyone who signed up with a code before passwords existed, and anyone who forgot theirs
  (log in with "Email me a code", then set a new one). If the project requires a recent proof
  for password changes, Supabase emails a code first and the screen asks for it. It only changes
  the account it was opened for: if a different account is signed in by the time it saves, it
  refuses and changes nothing.

Code: `_shared/api/signIn.ts` (logic, tested in `tests/signIn.test.ts`), `api/signInStore.ts`,
`src/lib/auth.ts`, `src/lib/socialSignIn.ts`.

## Setup checklist for Apple and Google (Mike)

Both need a new EAS build: native sign-in doesn't work in Expo Go (Google) or without the
entitlement (Apple). `app.config.ts` adds each provider to the build only when its env var is
set, so builds stay exactly as before until then.

### Sign in with Apple (iOS)

1. In Apple Developer → Certificates, IDs & Profiles → Identifiers, open `edu.stonybrook.wtw` and
   turn on **Sign In with Apple**. (EAS can also sync this capability on build.)
2. In Supabase → Authentication → Providers → **Apple**, enable it and set **Client IDs** to
   `edu.stonybrook.wtw`. Add `host.exp.Exponent` too if you want to test in Expo Go. A native
   app doesn't need the Services ID, key or secret.
3. In the EAS env for the build, set `EXPO_PUBLIC_APPLE_SIGN_IN=1`, then rebuild.

### Sign in with Google (iOS + Android)

On iOS, Google only shows when the Apple button is actually showing on that device (App Store
guideline 4.8 requires offering Sign in with Apple alongside any other third-party sign-in).
Set up Apple first.

1. In Google Cloud → Google Auth Platform, configure the consent screen with scopes `openid`,
   `…/auth/userinfo.email` and `…/auth/userinfo.profile`.
2. Under Credentials, create three OAuth client IDs:
   - **Web application** (Supabase needs it, even for native).
   - **iOS**, bundle ID `edu.stonybrook.wtw`.
   - **Android**, package `edu.stonybrook.wtw`, with the SHA-1 from `npx eas-cli credentials`
     for each build profile.
3. In Supabase → Authentication → Providers → **Google**, enable it and set **Client IDs** to the
   web, iOS and Android IDs, comma-separated, **web first**. Turn on **Skip nonce check**: the
   free Google Sign-In library can't send a nonce on Android.
4. In the EAS env, set `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=<web id>` and
   `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=<ios id>`, then rebuild.

### Email + password (hosted project)

- Supabase → Authentication → Providers → **Email** must allow password sign-in (on by default),
  with a minimum password length of 8 or less.
- If **Secure password change** is on, it still works: the welcome screen sets the password
  right after the code sign-in.

### Deploy order

- Migration **0057** merges after 0053–0055 (the pick-flow and Hang PRs) and 0056 (#78),
  because CI rejects out-of-order migrations.
- The backend (`/auth/password-login`, `/usernames/available`) deploys on merge to `main`, before
  the app update.
- Older apps keep working as before. They just don't show the new options.
