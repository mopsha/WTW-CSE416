import { useCallback, useState } from 'react';

import { messageOf } from '@/lib/errors';
import { haptic } from '@/lib/haptics';

/**
 * Runs one host/participant action at a time (Start, Close now, Vote…), tracking which one is
 * busy and the last error, so buttons can show a spinner and the screen an error banner.
 */
export function useAction() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (name: string, fn: () => Promise<unknown>) => {
    setBusy(name);
    setError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      haptic.error();
      setError(messageOf(e));
      return false;
    } finally {
      setBusy(null);
    }
  }, []);

  return { busy, error, run, clearError: () => setError(null) };
}
