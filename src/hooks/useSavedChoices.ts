import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';
import { SavedChoices } from '@/lib/savedChoices';

export function useSavedChoices(viewer: string) {
  const [saved] = useState(() => new SavedChoices(viewer));
  const revision = useSyncExternalStore(saved.subscribe, saved.snapshot, saved.snapshot);
  useLayoutEffect(() => {
    saved.activate();
    return () => saved.dispose();
  }, [saved]);
  const token = saved.undo?.token;
  useEffect(() => {
    if (token === undefined) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const start = (ms: number) => {
      if (active) timer = setTimeout(() => saved.dismissUndo(token), ms);
    };
    // Give assistive technology its OS-recommended action window; no animation is necessary.
    void Promise.resolve(AccessibilityInfo.getRecommendedTimeoutMillis(6000)).then(
      (ms) => start(Math.max(6000, ms || 6000)),
      () => start(6000),
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [saved, token]);
  return { saved, revision };
}
