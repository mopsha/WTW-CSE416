import { ApiError } from '../_shared/api/errors.ts';
import type { GroupIdea, GroupIdeaInput, GroupIdeasStore } from '../_shared/api/groupIdeas.ts';
import { createServiceClient } from './serviceClient.ts';

type Row = {
  id: string;
  group_id: string;
  created_by: string;
  name: string;
  category: 'activity' | 'food';
  description: string | null;
  location_text: string | null;
  created_at: string;
  updated_at: string;
};
const idea = (r: Row): GroupIdea => ({
  id: r.id,
  groupId: r.group_id,
  createdBy: r.created_by,
  name: r.name,
  category: r.category,
  description: r.description,
  locationText: r.location_text,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export function createGroupIdeasStore(): GroupIdeasStore {
  async function rpc(
    action: string,
    userId: string,
    groupId: string,
    ideaId: string | null = null,
    input?: GroupIdeaInput,
  ) {
    const { data, error } = await createServiceClient().rpc('group_ideas', {
      p_action: action,
      p_user_id: userId,
      p_group_id: groupId,
      p_idea_id: ideaId,
      p_input: input ?? {},
    });
    if (error) {
      if (error.code === 'PT404') throw new ApiError(404, 'NOT_FOUND', 'Group or idea not found');
      if (error.code === 'PT403')
        throw new ApiError(
          403,
          'FORBIDDEN',
          'Only the creator can edit; the creator or group owner can delete',
        );
      if (error.code === 'PT400' || error.code === '23514')
        throw new ApiError(400, 'INVALID_INPUT', 'Invalid idea');
      if (error.code === 'PGRST202' || error.code === 'PGRST205')
        throw new ApiError(503, 'DATABASE_NOT_READY', 'Group Ideas are not installed');
      throw new Error('Group Ideas database operation failed');
    }
    return data;
  }
  return {
    list: async (u, g) => ((await rpc('list', u, g)) as Row[]).map(idea),
    get: async (u, g, id) => idea(await rpc('get', u, g, id)),
    create: async (u, g, input) => idea(await rpc('create', u, g, null, input)),
    update: async (u, g, id, input) => idea(await rpc('update', u, g, id, input)),
    delete: async (u, g, id) => {
      await rpc('delete', u, g, id);
    },
  };
}
