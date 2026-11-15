import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/** Start without motion until the OS preference is known; observe changes while mounted. */
export function useMotionPreference() {
  const [reduced, setReduced] = useState(true);
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
        /* Keep motion off when the setting cannot be read. */
      },
    );
    return () => {
      active = false;
      subscription?.remove();
    };
  }, []);
  return reduced;
}
