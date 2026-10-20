import { useCallback, useState } from 'react';

import { api } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { BAD_CODE_MESSAGE, joinErrorMessage, parseJoinCode } from '@/lib/join';

/**
 * Join a Pick by code (the Picks tab box and the wtw://join/CODE link). Resolves to the Pick
 * id, or null after setting `error`; callers then open /pick/[id], which forwards to the
 * current step (the Lobby for a draft Pick).
 */
export function useJoinPick() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const join = useCallback(async (input: string): Promise<string | null> => {
    setError(null);
    const code = parseJoinCode(input);
    if (!code) {
      setError(BAD_CODE_MESSAGE);
      return null;
    }
    setBusy(true);
    try {
      const { pickId } = await api.joinPick(code);
      haptic.success();
      return pickId;
    } catch (e) {
      haptic.error();
      setError(joinErrorMessage(e));
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  return { busy, error, join, clearError: () => setError(null) };
}
