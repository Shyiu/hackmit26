import type { Geofence } from "@memory-glasses/db";

export type GeoPoint = { lat: number; lng: number };

export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const radius = 6_371_000;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLat = lat2 - lat1;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(h));
}

export function metersOutside(geofence: Geofence, point: GeoPoint, accuracyMeters: number | null): number {
  return haversineMeters(geofence, point) - geofence.radiusMeters - (accuracyMeters ?? 0);
}

export function isInside(geofence: Geofence, point: GeoPoint, accuracyMeters: number | null): boolean {
  return metersOutside(geofence, point, accuracyMeters) <= 0;
}
