// Where Discover searches: the device's location if permission was already granted, else the
// Stony Brook fallback. Never prompts; onboarding and Create Pick are where location is asked.
import { useEffect, useState } from 'react';

import type { LatLng } from '@shared/domain/geo.ts';

import { USE_MOCK } from '@/lib/config';
import { areaName, currentLocation } from '@/lib/locationSearch';
import { CAMPUS } from '@/lib/places';

export interface DiscoverArea {
  center: LatLng;
  /** "Port Jefferson", or null when unknown (shown as "Near you"). */
  name: string | null;
  /** True when center is the device's position rather than the fallback. */
  device: boolean;
}

/** Mock fixtures are all near campus, so mock mode always searches there. */
export const FALLBACK_AREA: DiscoverArea = { center: CAMPUS, name: 'Stony Brook', device: false };
const LOCATE_TIMEOUT_MS = 5000;

/** ~110 m buckets: stable requests and cache keys, and no more precision than a search needs. */
const rounded = (p: LatLng): LatLng => ({
  lat: Math.round(p.lat * 1000) / 1000,
  lng: Math.round(p.lng * 1000) / 1000,
});

/** Null until the area is known, so Discover doesn't spend a search on the fallback first. */
export function useDiscoverArea(): DiscoverArea | null {
  const [area, setArea] = useState<DiscoverArea | null>(USE_MOCK ? FALLBACK_AREA : null);
  useEffect(() => {
    if (USE_MOCK) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), LOCATE_TIMEOUT_MS);
    });
    Promise.race([currentLocation({ prompt: false }).catch(() => null), timeout])
      .then((here) => {
        if (!active) return;
        if (!here) {
          setArea(FALLBACK_AREA);
          return;
        }
        const center = rounded(here);
        setArea({ center, name: null, device: true });
        void areaName(center).then((name) => {
          if (active && name) setArea((a) => (a?.center === center ? { ...a, name } : a));
        });
      })
      .finally(() => clearTimeout(timer));
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, []);
  return area;
}

/** "AROUND PORT JEFFERSON", or "NEAR YOU" before the name is known. */
export function areaEyebrow(area: DiscoverArea | null): string {
  if (!area) return 'FINDING YOUR AREA…';
  return area.name ? `AROUND ${area.name.toUpperCase()}` : 'NEAR YOU';
}
