import { ApiError } from './errors.ts';
import { requireCleanText } from './text.ts';

/** A reusable, unscheduled group idea; never a Pick candidate implicitly. */
export interface GroupIdeaInput {
  name: string;
  category: 'activity' | 'food';
  description?: string | null;
  locationText?: string | null;
}
export interface GroupIdea extends GroupIdeaInput {
  id: string;
  groupId: string;
  createdBy: string;
  description: string | null;
  locationText: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface GroupIdeasStore {
  list(userId: string, groupId: string): Promise<GroupIdea[]>;
  get(userId: string, groupId: string, ideaId: string): Promise<GroupIdea>;
  create(userId: string, groupId: string, input: GroupIdeaInput): Promise<GroupIdea>;
  update(
    userId: string,
    groupId: string,
    ideaId: string,
    input: GroupIdeaInput,
  ): Promise<GroupIdea>;
  delete(userId: string, groupId: string, ideaId: string): Promise<void>;
}

export function parseGroupIdea(body: unknown): GroupIdeaInput {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new ApiError(400, 'INVALID_INPUT', 'An idea is required');
  const b = body as Record<string, unknown>;
  const text = (value: unknown, label: string, max: number, required = false) => {
    if (value == null && !required) return null;
    if (typeof value !== 'string')
      throw new ApiError(400, 'INVALID_INPUT', `${label} must be text`);
    const trimmed = value.trim();
    if (
      (required && !trimmed) ||
      [...trimmed].length > max ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(trimmed)
    )
      throw new ApiError(
        400,
        'INVALID_INPUT',
        `${label} must be ${required ? '1' : '0'}–${max} characters`,
      );
    requireCleanText(trimmed, label.toLowerCase());
    return trimmed || null;
  };
  const name = text(b.name, 'Name', 60, true)!;
  if (b.category !== 'activity' && b.category !== 'food')
    throw new ApiError(400, 'INVALID_INPUT', 'Category must be activity or food');
  return {
    name,
    category: b.category,
    description: text(b.description, 'Description', 200),
    locationText: text(b.locationText, 'Location', 200),
  };
}
