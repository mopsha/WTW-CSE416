import { useEffect, useRef, useState } from 'react';

import type { Toast } from '@/components/ActivityToast';
import { colorForName } from '@/lib/avatar';
import type { PickProgress } from '@/lib/types';

/**
 * The demo's "live group activity" toasts, driven by real progress: someone joined, someone
 * finished, someone voted. Never what anyone answered (FR-11), only counts and names.
 */
export function useProgressToasts(progress: PickProgress | null) {
  const [toast, setToast] = useState<Toast | null>(null);
  const nextId = useRef(1);
  const seen = useRef<PickProgress | null>(null);

  const show = (emoji: string, text: string, color?: string) =>
    setToast({ id: nextId.current++, emoji, text, color });

  useEffect(() => {
    const before = seen.current;
    seen.current = progress;
    if (!before || !progress) return;
    const old = new Map(before.participants.map((p) => [p.userId, p]));
    for (const p of progress.participants) {
      if (p.isMe) continue;
      const was = old.get(p.userId);
      const color = colorForName(p.displayName);
      if (!was) show('👋', `${p.displayName} joined the Pick`, color);
      else if (p.done && !was.done) show('✅', `${p.displayName} finished swiping`, color);
      else if (p.voted && !was.voted) show('🗳️', `${p.displayName} voted`, color);
    }
  }, [progress]);

  return { toast, show };
}
