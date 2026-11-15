import { useReducedMotion } from 'react-native-reanimated';
import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/** Seed entrance configuration synchronously; then track the current OS preference. */
export function useMotionPreference() {
  const initialPreference = useReducedMotion();
  const [reduced, setReduced] = useState(initialPreference);
  useEffect(() => {
    let active = true;
    let changed = false;
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (value) => {
      changed = true;
      if (active) setReduced(value);
    });
    void Promise.resolve(AccessibilityInfo.isReduceMotionEnabled()).then(
      (value) => {
        if (active && !changed && typeof value === 'boolean') setReduced(value);
      },
      () => {
        /* Retain the synchronous preference when a fresh read is unavailable. */
      },
    );
    return () => {
      active = false;
      subscription?.remove();
    };
  }, []);
  return reduced;
}
