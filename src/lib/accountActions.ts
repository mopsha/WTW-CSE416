import { auth } from './auth';
import { api } from './api';
import { confirmAction } from './confirm';
import { unregisterFromPush } from './push';

export interface AccountActionDependencies {
  unregisterPush(): Promise<void>;
  signOut(): Promise<void>;
  deleteAccount(): Promise<unknown>;
  confirmDelete(): Promise<boolean>;
}
/** One shared flow for Profile and Settings; session updates come from the auth service. */
export function createAccountActions(deps: AccountActionDependencies) {
  let pending = false;
  const guard = async <T>(action: () => Promise<T>) => {
    if (pending) throw new Error('An account action is already in progress.');
    pending = true;
    try {
      return await action();
    } finally {
      pending = false;
    }
  };
  return {
    logOut: () =>
      guard(async () => {
        await deps.unregisterPush().catch(() => {});
        await deps.signOut();
      }),
    deleteAccount: () =>
      guard(async () => {
        if (!(await deps.confirmDelete())) return false;
        await deps.deleteAccount();
        try {
          await deps.signOut();
        } catch {
          throw new Error('Your account was deleted. Use Log out to finish signing out.');
        }
        return true;
      }),
  };
}
export const accountActions = createAccountActions({
  unregisterPush: unregisterFromPush,
  signOut: () => auth.signOut(),
  deleteAccount: () => api.deleteMe(),
  confirmDelete: () =>
    confirmAction({
      title: 'Delete your account?',
      message:
        'This permanently deletes your account and personal settings. Shared Pick history may remain without your account. This can’t be undone.',
      confirmLabel: 'Delete account',
      destructive: true,
    }),
});
