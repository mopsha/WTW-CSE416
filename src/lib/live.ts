// Change feed for one Pick: Supabase Realtime in real mode, the mock store's emitter in mock
// mode. It only says "something changed"; usePickLive then re-reads GET /picks/:id/progress, so
// nothing private ever travels over the socket (ranking_results and preferences are not in the
// publication at all).
import { USE_MOCK } from './config';
import { subscribeMock } from './mock/store';
import { getSupabase } from './supabase';

export type LiveStatus = 'live' | 'failed';

export interface LiveSource {
  subscribe(pickId: string, onChange: () => void, onStatus: (s: LiveStatus) => void): () => void;
}

/** Channel statuses from supabase-js that mean "fall back to polling". */
export function isFailedStatus(status: string): boolean {
  return status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED';
}

const realtime: LiveSource = {
  subscribe(pickId, onChange, onStatus) {
    const supabase = getSupabase();
    const channel = supabase
      .channel(`pick:${pickId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'picks', filter: `id=eq.${pickId}` },
        onChange,
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'pick_participants',
          filter: `pick_id=eq.${pickId}`,
        },
        onChange,
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') onStatus('live');
        else if (isFailedStatus(status)) onStatus('failed');
      });
    return () => {
      void supabase.removeChannel(channel);
    };
  },
};

const mock: LiveSource = {
  subscribe(pickId, onChange, onStatus) {
    onStatus('live');
    return subscribeMock(pickId, onChange);
  },
};

export const live: LiveSource = USE_MOCK ? mock : realtime;
