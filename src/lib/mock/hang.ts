import { parseHang, type HangPost } from '@shared/api/hang.ts';
import { errorResponse } from '@shared/api/errors.ts';
import { MOCK_USER_ID } from './auth';
const posts: HangPost[] = [];
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const blocked = (code: string, message: string) => json({ error: { code, message } }, 503);
export function mockHang(method: string, path: string, body: unknown): Response | null {
  if (path === '/hang' && method === 'GET')
    return json({
      posts: posts.filter(
        (p) => p.authorId === MOCK_USER_ID && Date.parse(p.expiresAt) > Date.now(),
      ),
      sharedAvailable: false,
      notice: 'Sharing and responses are not available yet.',
    });
  if (path === '/hang' && method === 'POST') {
    try {
      const input = parseHang(body);
      if (input.audience === 'group')
        return blocked('HANG_GROUPS_UNAVAILABLE', 'Group hang posts are not available yet');
      const post = { ...input, id: `mock-hang-${posts.length + 1}`, authorId: MOCK_USER_ID };
      posts.push(post);
      return json(post, 201);
    } catch (error) {
      const safe = errorResponse(error);
      return json(safe.body, safe.status);
    }
  }
  const match = /^\/hang\/([^/]+)\/(respond|pick)$/.exec(path);
  if (method === 'POST' && match) {
    const post = posts.find((p) => p.id === match[1] && Date.parse(p.expiresAt) > Date.now());
    if (!post)
      return json({ error: { code: 'HANG_NOT_FOUND', message: 'Hang post not found' } }, 404);
    return blocked(
      match[2] === 'pick' ? 'HANG_PICK_HELPER_UNAVAILABLE' : 'HANG_RELATIONSHIPS_UNAVAILABLE',
      'Shared hang posts are not available yet',
    );
  }
  return null;
}
