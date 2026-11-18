import { useFocusEffect } from 'expo-router';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { AppState } from 'react-native';
import {
  FAILURE_TTL_MS,
  isPhotoAccount,
  loadPhoto,
  photoRevision,
  photoState,
  revalidatePhotos,
  setPhotoAccount,
  subscribePhotos,
  type PhotoSource,
} from '@/lib/photoCache';

/** Only visible/current+next photos may request work. Expiry asks the owning flow for fresh metadata. */
export function usePhotoRequests(
  owner: string,
  sources: readonly PhotoSource[],
  refresh: () => void,
) {
  const revision = useSyncExternalStore(subscribePhotos, photoRevision, photoRevision);
  const [foreground, setForeground] = useState(
    AppState.currentState !== 'background' && AppState.currentState !== 'inactive',
  );
  const [focused, setFocused] = useState(false);
  const [resume, setResume] = useState(0);
  const refreshRef = useRef(refresh);
  useLayoutEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);
  const lastRefresh = useRef<number | null>(null);
  useLayoutEffect(() => setPhotoAccount(owner), [owner]);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      setResume((value) => value + 1);
      return () => setFocused(false);
    }, []),
  );
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      setForeground(state === 'active');
      if (state === 'active') setResume((value) => value + 1);
    });
    return () => sub.remove();
  }, []);
  useEffect(() => {
    if (!owner || !isPhotoAccount(owner) || !focused || !foreground) return;
    revalidatePhotos(sources);
    if (sources.some((source) => photoState(source).expired)) {
      const previous = lastRefresh.current;
      // One refresh per flow, even if scrolling changes the set of expired visible handles.
      const remaining = previous === null ? 0 : FAILURE_TTL_MS - (Date.now() - previous);
      if (remaining > 0) {
        const timer = setTimeout(() => setResume((value) => value + 1), remaining);
        return () => clearTimeout(timer);
      }
      lastRefresh.current = Date.now();
      refreshRef.current();
      return;
    }
    sources.forEach((source) => {
      void loadPhoto(source);
    });
  }, [owner, sources, focused, foreground, resume, revision]);
  return useMemo(
    () => ({ revision, resume, foreground, focused }),
    [revision, resume, foreground, focused],
  );
}
