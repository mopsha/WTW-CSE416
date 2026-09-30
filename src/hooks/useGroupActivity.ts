import { useEffect, useRef, useState } from 'react';

import type { Toast } from '@/components/ActivityToast';
import { FRIENDS } from '@/components/theme';

const [AVA, BEN, CAM] = FRIENDS;

/**
 * DEMO ONLY: a scripted feed of the other participants' progress (the seeded bot friends),
 * so a recording shows the group "live". It never reveals how anyone swiped (FR-11): only
 * joins, progress counts and "finished". Real presence would come from Supabase Realtime.
 */
export function useGroupActivity(active: boolean, answered: number, total: number) {
  const [toast, setToast] = useState<Toast | null>(null);
  const [done, setDone] = useState<ReadonlySet<string>>(new Set());
  const nextId = useRef(1);
  const halfwayShown = useRef(false);

  const show = (emoji: string, text: string, color?: string) =>
    setToast({ id: nextId.current++, emoji, text, color });

  useEffect(() => {
    if (!active) return;
    const finish = (name: string, color: string) => {
      setDone((d) => new Set(d).add(name));
      show('✅', `${name} finished swiping`, color);
    };
    const steps: [number, () => void][] = [
      [2200, () => show('👋', `${BEN!.name} joined the Pick`, BEN!.color)],
      [6500, () => show('🔥', `${CAM!.name} is swiping… 6/20`, CAM!.color)],
      [11000, () => finish(AVA!.name, AVA!.color)],
      [17500, () => finish(BEN!.name, BEN!.color)],
      [24000, () => finish(CAM!.name, CAM!.color)],
    ];
    const timers = steps.map(([ms, fn]) => setTimeout(fn, ms));
    return () => timers.forEach(clearTimeout);
  }, [active]);

  useEffect(() => {
    if (!active || halfwayShown.current || total === 0) return;
    if (answered >= Math.ceil(total / 2) && answered < total) {
      halfwayShown.current = true;
      show('⚡', `Halfway there! ${answered}/${total}`, '#FF7A45');
    }
  }, [active, answered, total]);

  return { toast, done, show };
}
