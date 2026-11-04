# App Store review account

WTW signs people in with emailed codes, which Apple's reviewer can't receive. So one account,
`appreview@getwtw.app` (`REVIEW_EMAIL` in `src/lib/config.ts`), signs in with a password. Entering
that email on the sign-in screen shows a password field. Nobody else sees it, and no other account
has a password. The password is never in the repo or the app.

## Set up before submitting

1. In the Supabase dashboard, go to Authentication > Users > Add user > Create new user.
2. Enter `appreview@getwtw.app`, a long random password from a password manager, and turn on
   auto-confirm. Store the password in the password manager only.
3. Sign in on a phone and finish setup with the name `App Review` and an unused username.
4. Give the reviewer something to see, using a second test account: an accepted friendship, a
   group with messages, and an active Pick.

Check that sign-in works on the exact build you submit.

## App Store Connect review notes

Put the email and password in the Sign-in Information fields, and add:

> WTW normally signs people in with an emailed code. This review account uses a password instead:
> enter the email on the Log In screen, tap the button, then enter the password. To try group
> features, open the group already on this account. Report and block are under the "…" on messages,
> profiles and group members. Account deletion is under Profile > Delete account.

## After review

- If the reviewer deleted the account, repeat the setup before the next submission.
- Change the password if it may have been exposed. Rate limits on sign-in attempts are Supabase's.
