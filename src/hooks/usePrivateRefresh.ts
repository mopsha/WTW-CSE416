import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { AppState } from 'react-native';
export const PRIVATE_REFRESH_MS = 5000;
/** Revalidate private projections while visible; clear and invalidate pending reads on blur/background. */
export function usePrivateRefresh(
  refresh: () => Promise<void>,
  clear: () => void,
  periodMs = PRIVATE_REFRESH_MS,
) {
  useFocusEffect(
    useCallback(() => {
      let active = true;
      let foreground =
        AppState.currentState !== 'background' && AppState.currentState !== 'inactive';
      let inflight = false;
      let again = false;
      async function load() {
        if (!active || !foreground) return;
        if (inflight) {
          again = true;
          return;
        }
        inflight = true;
        try {
          await refresh();
        } catch {
          /* Projection loaders own user-facing errors and cache clearing. */
        } finally {
          inflight = false;
          if (again) {
            again = false;
            void load();
          }
        }
      }
      void load();
      const timer = setInterval(() => void load(), periodMs);
      const sub = AppState.addEventListener('change', (state) => {
        foreground = state === 'active';
        if (foreground) void load();
        else clear();
      });
      return () => {
        active = false;
        clearInterval(timer);
        sub.remove();
        clear();
      };
    }, [refresh, clear, periodMs]),
  );
}
