import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useRef, useState } from 'react';

import {
  validDiscoverLocationId,
  type ResolvedDiscoverLocation,
} from '@shared/api/discoverLocation.ts';
import { validCenter, type LatLng } from '@shared/domain/geo.ts';

import { api } from '@/lib/api';
import { USE_MOCK } from '@/lib/config';
import { areaName, currentLocation } from '@/lib/locationSearch';
import { CAMPUS } from '@/lib/places';

export interface DiscoverArea {
  center: LatLng;
  name: string | null;
  mode: 'manual' | 'current';
  device: boolean;
  placeId?: string;
  attributions?: ResolvedDiscoverLocation['attributions'];
}

const FALLBACK_AREA: DiscoverArea = {
  center: CAMPUS,
  name: 'Stony Brook',
  mode: 'current',
  device: false,
};
const LOCATE_TIMEOUT_MS = 5000;

// Order writes and reads of the same account's choice across tab remounts.
const pendingWrites = new Map<string, Promise<void>>();

function manualArea(
  location: ResolvedDiscoverLocation,
  expectedId = location?.id,
): DiscoverArea | null {
  const name = typeof location?.label === 'string' ? location.label.trim() : '';
  return validDiscoverLocationId(expectedId) &&
    location?.id === expectedId &&
    validCenter(location.center) &&
    name &&
    name.length <= 512
    ? {
        mode: 'manual',
        center: location.center,
        name,
        device: false,
        placeId: expectedId,
        attributions: location.attributions,
      }
    : null;
}

/** GPS requests use ~110 m buckets for stable queries and limited precision. */
const deviceArea = ({ lat, lng }: LatLng): DiscoverArea => ({
  center: { lat: Math.round(lat * 1000) / 1000, lng: Math.round(lng * 1000) / 1000 },
  mode: 'current',
  name: null,
  device: true,
});

export function useDiscoverArea(userId: string) {
  const key = `wtw.discover-area.v1.${userId}`;
  const [area, setArea] = useState<DiscoverArea | null>(null);
  const [storageError, setStorageError] = useState(false);
  const [restoreError, setRestoreError] = useState(false);
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const [revision, setRevision] = useState(0);
  const changed = useRef(false);
  const mounted = useRef(false);
  const restoring = useRef<AbortController | null>(null);
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    restoring.current = controller;
    const isCurrent = () => !controller.signal.aborted && !changed.current;
    async function initialize() {
      try {
        await pendingWrites.get(key);
        if (!userId || !isCurrent()) return;
        const stored = await AsyncStorage.getItem(key);
        if (!isCurrent()) return;
        // Google permits durable storage of the place ID. Resolve fresh details each mount.
        if (validDiscoverLocationId(stored)) {
          const { location } = await api.resolveDiscoverLocation(stored, userId, controller.signal);
          if (!isCurrent()) return;
          const manual = manualArea(location, stored);
          if (!manual) throw new Error('Invalid saved location');
          setArea(manual);
          return;
        }
      } catch {
        if (isCurrent()) {
          setRestoreError(true);
          setArea(FALLBACK_AREA);
        }
        return;
      }
      const here = USE_MOCK
        ? null
        : await currentLocation({ prompt: false, timeoutMs: LOCATE_TIMEOUT_MS }).catch(() => null);
      if (isCurrent()) setArea(validCenter(here) ? deviceArea(here) : FALLBACK_AREA);
    }
    void initialize();
    return () => {
      controller.abort();
      mounted.current = false;
    };
  }, [key, userId, restoreAttempt]);

  const center = area?.device ? area.center : null;
  useEffect(() => {
    if (!center) return;
    let active = true;
    void areaName(center).then((name) => {
      if (active && name) setArea((a) => (a?.center === center ? { ...a, name } : a));
    });
    return () => {
      active = false;
    };
  }, [center]);

  function apply(next: DiscoverArea) {
    changed.current = true;
    restoring.current?.abort();
    setRestoreError(false);
    setArea(next);
    setRevision((value) => value + 1);
    if (!userId) return;
    const write = (pendingWrites.get(key) ?? Promise.resolve()).then(async () => {
      try {
        if (next.placeId) await AsyncStorage.setItem(key, next.placeId);
        else await AsyncStorage.removeItem(key);
        if (mounted.current) setStorageError(false);
      } catch {
        if (mounted.current) setStorageError(true);
      }
    });
    pendingWrites.set(key, write);
    void write.then(() => {
      if (pendingWrites.get(key) === write) pendingWrites.delete(key);
    });
  }

  function selectManual(location: ResolvedDiscoverLocation) {
    const manual = manualArea(location);
    if (!manual) return false;
    apply(manual);
    return true;
  }

  function selectCurrent(here: LatLng) {
    if (validCenter(here)) apply(deviceArea(here));
  }

  function selectFallback() {
    apply(FALLBACK_AREA);
  }

  function retryRestore() {
    setRestoreError(false);
    setArea(null);
    setRevision((value) => value + 1);
    setRestoreAttempt((value) => value + 1);
  }

  return {
    area,
    revision,
    selectManual,
    selectCurrent,
    selectFallback,
    storageError,
    restoreError,
    retryRestore,
  };
}

export function areaEyebrow(area: DiscoverArea | null): string {
  if (!area) return 'FINDING YOUR AREA…';
  return area.name ? `AROUND ${area.name.toUpperCase()}` : 'NEAR YOU';
}
