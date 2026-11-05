import { ApiError } from './errors.ts';

export const AVATAR_MAX_BYTES = 1024 * 1024;
export interface AvatarRef {
  userId: string;
  revision: number;
}
export interface AvatarChange {
  revision: number;
  avatarRef: AvatarRef | null;
}
export interface AvatarCapabilities {
  uploadsEnabled: boolean;
  reportsEnabled: boolean;
}
export interface AvatarStore {
  capabilities?(userId: string): Promise<AvatarCapabilities>;
  upload(userId: string, revision: number, bytes: Uint8Array): Promise<AvatarChange>;
  remove(userId: string, revision: number): Promise<AvatarChange>;
  read(viewerId: string, targetId: string, revision: number): Promise<Uint8Array>;
  cleanup(): Promise<void>;
  resolve?(viewerId: string, userIds: string[]): Promise<Record<string, AvatarChange>>;
}

export function parseAvatarRevision(value: unknown): number {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,14})$/.test(value))
    throw new ApiError(400, 'INVALID_INPUT', 'Expected photo revision');
  const revision = Number(value);
  if (!Number.isSafeInteger(revision))
    throw new ApiError(400, 'INVALID_INPUT', 'Invalid photo revision');
  return revision;
}

/** Enforce actual streamed bytes, including requests without Content-Length. */
export async function readAvatarBody(request: Request): Promise<Uint8Array> {
  if (request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'image/jpeg')
    throw new ApiError(400, 'INVALID_IMAGE', 'Expected a JPEG photo');
  if (!request.body) throw new ApiError(400, 'INVALID_IMAGE', 'Empty photo');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > AVATAR_MAX_BYTES) {
        await reader.cancel();
        throw new ApiError(400, 'IMAGE_TOO_LARGE', 'Photo must be at most 1 MiB');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (!size) throw new ApiError(400, 'INVALID_IMAGE', 'Empty photo');
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
