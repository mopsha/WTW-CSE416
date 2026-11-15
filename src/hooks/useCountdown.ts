import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { formatCountdown } from '@/lib/time';

/** Display only: the backend remains authoritative for deadline enforcement. */
export function useCountdown(deadlineAt: string | null): { label: string | null; passed: boolean } {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!deadlineAt) return;
    const deadline = Date.parse(deadlineAt);
    let timer: ReturnType<typeof setInterval> | undefined;
    const stop = () => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    };
    const sample = () => {
      const time = Date.now();
      setNow(time);
      if (time >= deadline || !Number.isFinite(deadline)) stop();
    };
    const resume = () => {
      stop();
      sample();
      if (Number.isFinite(deadline) && Date.now() < deadline) timer = setInterval(sample, 1000);
    };
    if (AppState.currentState !== 'background' && AppState.currentState !== 'inactive') resume();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') resume();
      else stop();
    });
    return () => {
      stop();
      subscription.remove();
    };
  }, [deadlineAt]);
  if (!deadlineAt) return { label: null, passed: false };
  const ms = Date.parse(deadlineAt) - now;
  return { label: formatCountdown(ms), passed: ms <= 0 };
}
