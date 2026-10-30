#!/usr/bin/env node
// Hand out a WTW sign-in code for wtw-dev WITHOUT sending an email (Mike, M3).
//
// Why: hosted Supabase only lets you customize email templates with your own SMTP, and the
// default template emails a magic link, not the 6-digit code the app asks for. Until we set
// up SMTP (M4), this asks Supabase Auth's admin API for the code directly (`generate_link`,
// which sends nothing) so you can text it to a teammate, who types it into the app.
//
// Usage (from the repo root, on a trusted machine only):
//   1. Put the wtw-dev service-role key in .env.server.local (gitignored; NOT .env.local,
//      which Expo reads):  SUPABASE_SERVICE_ROLE_KEY=...
//   2. node --env-file=.env.server.local scripts/wtw-dev-code.mjs alan@stonybrook.edu "Alan"
//
// The name (optional, 1-50 characters) is what others see in the Lobby, Waiting room and
// votes. The app has no "what's your name?" step yet (M4), so without one a teammate shows
// up as "Someone". Pass it the first time; pass it again later to change it.
//
// The service-role key bypasses all security. Never commit it, paste it in chat, or put it
// in an EXPO_PUBLIC_* variable. Codes expire per Auth settings (default 1 hour), work once,
// and creating one replaces any earlier unused code for that email.

import { pathToFileURL } from 'node:url';

const DEFAULT_URL = 'https://bjjzuojyluebitkmrbwr.supabase.co'; // wtw-dev
const APP_CODE_LENGTH = 6; // the sign-in screen has 6 boxes

export const MAX_NAME_LENGTH = 50; // profiles.display_name check in 0001_init.sql

export class CodeError extends Error {}

function headersFor(key) {
  // Legacy service_role keys are JWTs; new secret keys (sb_secret_...) go in `apikey` only.
  const headers = { apikey: key, 'Content-Type': 'application/json' };
  if (!key.startsWith('sb_secret_')) headers.Authorization = `Bearer ${key}`;
  return headers;
}

async function readJson(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { message: text.slice(0, 200) };
  }
}

const errorText = (body) => body?.msg ?? body?.message ?? body?.error_description ?? body?.error;

/**
 * Returns { code, created, named } for `email`, creating the account first if it doesn't exist
 * and setting its display name when `name` is given.
 */
export async function signInCode({ email, name, url, key, fetch = globalThis.fetch }) {
  if (!key) {
    throw new CodeError(
      'SUPABASE_SERVICE_ROLE_KEY is not set. Put it in .env.server.local and run with ' +
        '--env-file=.env.server.local (see the top of this file).',
    );
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email ?? '')) {
    throw new CodeError(
      'Usage: node --env-file=.env.server.local scripts/wtw-dev-code.mjs <email> ["Display name"]',
    );
  }
  const displayName = name?.trim() || undefined;
  if (displayName && displayName.length > MAX_NAME_LENGTH) {
    throw new CodeError(`The name must be at most ${MAX_NAME_LENGTH} characters.`);
  }
  const base = url.replace(/\/+$/, '');
  const headers = headersFor(key);
  const generate = () =>
    fetch(`${base}/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ type: 'magiclink', email }),
    });

  let res = await generate();
  let body = await readJson(res);
  let created = false;

  // A brand-new teammate: create a confirmed account (no email sent), then ask again.
  if (!res.ok && (res.status === 404 || /not found/i.test(errorText(body) ?? ''))) {
    const make = await fetch(`${base}/auth/v1/admin/users`, {
      method: 'POST',
      headers,
      // The 0001 trigger copies user_metadata.display_name into the new profile.
      body: JSON.stringify({
        email,
        email_confirm: true,
        ...(displayName ? { user_metadata: { display_name: displayName } } : {}),
      }),
    });
    if (!make.ok) {
      throw new CodeError(
        `Could not create ${email}: ${errorText(await readJson(make)) ?? make.status}`,
      );
    }
    created = true;
    res = await generate();
    body = await readJson(res);
  }

  if (res.status === 401 || res.status === 403) {
    throw new CodeError('Supabase rejected the key. Is it the wtw-dev service-role key?');
  }
  if (!res.ok) throw new CodeError(`Supabase error ${res.status}: ${errorText(body) ?? 'unknown'}`);

  const code = body?.email_otp ?? body?.properties?.email_otp;
  if (typeof code !== 'string' || !code) {
    throw new CodeError('Supabase did not return a code (no email_otp in the response).');
  }

  // An existing account: set the name on its profile row (the server key may write it;
  // the app can't). A new account already got it from user_metadata above.
  let named = created && !!displayName;
  if (displayName && !created) {
    const userId = body?.id ?? body?.user?.id;
    if (typeof userId !== 'string') {
      throw new CodeError('Supabase did not return the user id, so the name was not set.');
    }
    const patch = await fetch(`${base}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify({ display_name: displayName }),
    });
    const rows = await readJson(patch);
    if (!patch.ok || !Array.isArray(rows) || rows.length !== 1) {
      throw new CodeError(
        `The code is ${code}, but setting the name failed (${patch.status}: ` +
          `${errorText(rows) ?? 'no profile row'}). Are the migrations deployed?`,
      );
    }
    named = true;
  }
  return { code, created, named };
}

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  const name = process.argv.slice(3).join(' ').trim() || undefined;
  const url = process.env.WTW_SUPABASE_URL ?? DEFAULT_URL;
  try {
    const { code, created, named } = await signInCode({
      email,
      name,
      url,
      key: process.env.SUPABASE_SERVICE_ROLE_KEY,
    });
    if (created) console.log(`Created a new WTW account for ${email}.`);
    if (named) console.log(`Others will see them as "${name}".`);
    else if (!name) {
      console.log('Tip: add their name after the email, or they show up as "Someone".');
    }
    console.log(`Sign-in code for ${email}: ${code}`);
    console.log('Valid once, for about an hour. Type it into the WTW app (no email is sent).');
    if (code.length !== APP_CODE_LENGTH) {
      console.warn(
        `Warning: this code has ${code.length} digits but the app expects ${APP_CODE_LENGTH}. ` +
          'Set Authentication -> Providers -> Email -> "Email OTP Length" to 6 in the dashboard.',
      );
    }
  } catch (e) {
    console.error(e instanceof CodeError ? e.message : `Unexpected error: ${e}`);
    process.exitCode = 1;
  }
}

// Run only when executed directly (importing it, e.g. from a test, does nothing).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
