import type { AccountStore } from '../_shared/api/account.ts';
import { createServiceClient } from './serviceClient.ts';

/** Service-role adapter for DELETE /me: Auth's admin API, never the client. */
export function createAccountStore(): AccountStore {
  return {
    async deleteUser(userId) {
      const { error } = await createServiceClient().auth.admin.deleteUser(userId);
      // 404: a retry after a deletion that succeeded but whose response was lost.
      if (!error || error.status === 404) return;
      throw new Error('Account deletion failed');
    },
  };
}
