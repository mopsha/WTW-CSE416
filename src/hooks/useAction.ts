import { useCallback, useEffect, useRef, useState } from 'react';

import { messageOf } from '@/lib/errors';
import { haptic } from '@/lib/haptics';

/** One action per hook instance. Use separate instances for independent concurrent actions.
 * run returns true on success, false on failure, and null when skipped or no longer mounted.
 */
export function useAction() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const lifecycle = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const epoch = lifecycle.current;
    return () => {
      mounted.current = false;
      lifecycle.current = epoch + 1;
    };
  }, []);

  const run = useCallback(async (name: string, fn: () => Promise<unknown>) => {
    if (!mounted.current || pending.current) return null;
    pending.current = true;
    const epoch = lifecycle.current;
    const current = () => mounted.current && lifecycle.current === epoch;
    setBusy(name);
    setError(null);
    try {
      await fn();
      return current() ? true : null;
    } catch (e) {
      if (!current()) return null;
      haptic.error();
      setError(messageOf(e));
      return false;
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(null);
    }
  }, []);

  const clearError = useCallback(() => {
    if (mounted.current) setError(null);
  }, []);
  return { busy, error, run, clearError };
}
