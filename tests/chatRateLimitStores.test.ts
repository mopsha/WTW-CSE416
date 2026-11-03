import type { GroupChatStore } from '@shared/api/groupChat.ts';
import type { DirectChatStore } from '@shared/api/directChat.ts';
const mockRpc = jest.fn();
jest.mock('../supabase/functions/api/serviceClient.ts', () => ({
  createServiceClient: () => ({ rpc: mockRpc }),
}));
const { createGroupChatStore } = jest.requireActual<{ createGroupChatStore(): GroupChatStore }>(
  '../supabase/functions/api/groupChatStore.ts',
);
const { createDirectChatStore } = jest.requireActual<{ createDirectChatStore(): DirectChatStore }>(
  '../supabase/functions/api/directChatStore.ts',
);
test.each([createGroupChatStore, createDirectChatStore])(
  'send quota errors map to HTTP 429',
  async (factory) => {
    mockRpc.mockResolvedValue({ data: null, error: { code: 'PT429', message: 'private details' } });
    await expect(
      factory().send('sender', 'target', { body: 'Hello', clientId: 'request-0001' }),
    ).rejects.toMatchObject({ status: 429, code: 'MESSAGE_RATE_LIMITED' });
  },
);
