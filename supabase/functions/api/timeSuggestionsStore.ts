import type {
  TimeSuggestions,
  TimeSuggestionsStore,
  TimeSuggestionMutation,
} from '../_shared/api/timeSuggestions.ts';
import { ApiError, type ErrorStatus } from '../_shared/api/errors.ts';
import { createServiceClient } from './serviceClient.ts';
export function createTimeSuggestionsStore(): TimeSuggestionsStore {
  async function rpc(name: string, args: Record<string, unknown>) {
    const { data, error } = await createServiceClient().rpc(name, args);
    if (error) {
      const status: Record<string, ErrorStatus> = {
        PT400: 400,
        PT403: 403,
        PT404: 404,
        PT409: 409,
      };
      if (status[error.code])
        throw new ApiError(status[error.code], 'TIME_SUGGESTION_ERROR', error.message);
      throw new ApiError(
        503,
        'TIME_SUGGESTIONS_UNAVAILABLE',
        'Time suggestions are unavailable. Try again later.',
      );
    }
    return data;
  }
  return {
    load: async (id, viewer) =>
      (await rpc('pick_time_suggestions_load', {
        p_pick_id: id,
        p_user_id: viewer,
      })) as TimeSuggestions,
    suggest: async (id, viewer, revision, planAt) =>
      (await rpc('pick_time_suggest', {
        p_pick_id: id,
        p_user_id: viewer,
        p_revision: revision,
        p_plan_at: planAt,
      })) as TimeSuggestionMutation,
    act: async (id, viewer, suggestion, revision, action) =>
      (await rpc('pick_time_suggestion_act', {
        p_pick_id: id,
        p_user_id: viewer,
        p_suggestion_id: suggestion,
        p_revision: revision,
        p_action: action,
      })) as TimeSuggestionMutation,
  };
}
