import { ApiError } from '@shared/api/errors.ts';
import { parseGroupIdea } from '@shared/api/groupIdeas.ts';
import { MOCK_USER_ID } from './auth';
import { mockGetGroup, mockGroupIdeas } from './groups';

let sequence = 0;
export function handleMockGroupIdeas(method: string, path: string, body: unknown) {
  const match = /^\/groups\/([^/]+)\/ideas(?:\/([^/]+))?$/.exec(path);
  if (!match) return null;
  const groupId = decodeURIComponent(match[1]!);
  const id = match[2] ? decodeURIComponent(match[2]) : null;
  try {
    const group = mockGetGroup(groupId);
    if (!group) throw new ApiError(404, 'NOT_FOUND', 'Group or idea not found');
    const idea = id ? mockGroupIdeas.get(id) : undefined;
    if (id && (!idea || idea.groupId !== groupId))
      throw new ApiError(404, 'NOT_FOUND', 'Group or idea not found');
    if (method === 'GET')
      return {
        status: 200,
        body: id
          ? { ...idea! }
          : {
              ideas: [...mockGroupIdeas.values()]
                .filter((i) => i.groupId === groupId)
                .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
                .map((i) => ({ ...i })),
            },
      };
    if (
      id &&
      (method === 'POST' || method === 'DELETE') &&
      idea!.createdBy !== MOCK_USER_ID &&
      (method !== 'DELETE' || group.ownerId !== MOCK_USER_ID)
    )
      throw new ApiError(
        403,
        'FORBIDDEN',
        'Only the creator can edit; the creator or group owner can delete',
      );
    if (id && method === 'DELETE') {
      mockGroupIdeas.delete(id);
      return { status: 200, body: { status: 'ok' } };
    }
    if (method === 'POST') {
      const input = parseGroupIdea(body);
      const now = new Date().toISOString();
      const value = {
        ...input,
        description: input.description ?? null,
        locationText: input.locationText ?? null,
        id: id ?? `mock-idea-${++sequence}`,
        groupId,
        createdBy: idea?.createdBy ?? MOCK_USER_ID,
        createdAt: idea?.createdAt ?? now,
        updatedAt: now,
      };
      mockGroupIdeas.set(value.id, value);
      return { status: id ? 200 : 201, body: { ...value } };
    }
    return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Route not found' } } };
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    return { status: e.status, body: { error: { code: e.code, message: e.message } } };
  }
}
