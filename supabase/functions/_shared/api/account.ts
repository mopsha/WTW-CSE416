// Deleting my account (Razin, M4). DELETE /me -> { status: 'ok' }.
// The API deletes the caller's Auth user with the service role; Postgres cascades that to
// their profile, and 0017_account_deletion.sql applies the rules (hosted Picks canceled or
// kept without a host, groups they own deleted, push tokens gone) in the same transaction.
// The caller is always the verified token's user: there is no way to name someone else.

/** Shown wherever a Pick's host deleted their account (picks.host_id is null). */
export const DELETED_USER_NAME = 'Deleted user';

/** Service-role adapter. Deleting a user who is already gone succeeds. */
export interface AccountStore {
  deleteUser(userId: string): Promise<void>;
}

export async function deleteAccount(store: AccountStore, userId: string) {
  await store.deleteUser(userId);
  return { status: 'ok' as const };
}
