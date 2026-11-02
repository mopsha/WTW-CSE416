import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/lib/api';
import { onNotificationReceived } from '@/lib/notify';

/**
 * My unread notifications, refreshed whenever the screen comes into focus (e.g. back from the
 * inbox) and when a push arrives while the app is open. A failed read keeps the last count.
 */
export function useUnreadCount(): number {
  const [unread, setUnread] = useState(0);
  // Only the newest read may update the count.
  const latest = useRef(0);

  const load = useCallback(() => {
    const request = ++latest.current;
    api.listNotifications().then(
      (r) => request === latest.current && setUnread(r.unreadCount),
      () => {},
    );
  }, []);

  useFocusEffect(load);
  useEffect(() => onNotificationReceived(load), [load]);

  return unread;
}
