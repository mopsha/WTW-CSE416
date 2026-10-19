import { useEffect, useState } from 'react';

import { formatCountdown } from '@/lib/time';

/** "12:04 left", ticking every second; null label without a deadline. */
export function useCountdown(deadlineAt: string | null): { label: string | null; passed: boolean } {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!deadlineAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [deadlineAt]);
  if (!deadlineAt) return { label: null, passed: false };
  const ms = Date.parse(deadlineAt) - now;
  return { label: formatCountdown(ms), passed: ms <= 0 };
}
