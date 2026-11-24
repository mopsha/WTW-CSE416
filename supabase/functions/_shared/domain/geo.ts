// Pure geometry helpers. No Deno / React Native imports: this file runs in the
// Edge Function, the app, and Jest.

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_M = 6_371_000;

const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** Great-circle distance in meters (haversine). */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The smallest lat/lng rectangle containing a circle, clamped to valid coordinates. */
export function boundingBox(center: LatLng, radiusM: number): { low: LatLng; high: LatLng } {
  const dLat = (radiusM / EARTH_RADIUS_M) * (180 / Math.PI);
  const cos = Math.cos(toRad(center.lat));
  const dLng = cos > 1e-6 ? Math.min(180, dLat / cos) : 180;
  const clamp = (v: number, max: number) => Math.max(-max, Math.min(max, v));
  return {
    low: { lat: clamp(center.lat - dLat, 90), lng: clamp(center.lng - dLng, 180) },
    high: { lat: clamp(center.lat + dLat, 90), lng: clamp(center.lng + dLng, 180) },
  };
}
