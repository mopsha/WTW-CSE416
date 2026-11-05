import type { AccountStore } from '../_shared/api/account.ts';
import { createServiceClient } from './serviceClient.ts';
import { deleteAccountPhotos } from './avatarStore.ts';

/** Service-role adapter for DELETE /me: Auth's admin API, never the client. */
export function createAccountStore(): AccountStore {
  return {
    async deleteUser(userId) {
      await deleteAccountPhotos(userId);
      const { error } = await createServiceClient().auth.admin.deleteUser(userId);
      // 404: a retry after a deletion that succeeded but whose response was lost.
      if (!error || error.status === 404) return;
      throw new Error('Account deletion failed');
    },
  };
}

/** Retry only persisted deletion intent. Failure keeps the profile frozen; it
 * cannot safely be restored after Storage deletion or an uncertain Auth commit. */
export async function retryPendingAccountDeletions() {
  const { data, error } = await createServiceClient().rpc('avatar_pending_deletions');
  if (error) throw new Error('Account deletion retries unavailable');
  let failed = 0;
  const ids = (data ?? []) as string[];
  for (const id of ids) {
    try {
      await createAccountStore().deleteUser(id);
    } catch {
      failed++;
    }
  }
  return { status: failed ? 'partial_failure' : 'ok', attempted: ids.length, failed };
}
