/**
 * Client-supplied geo for pharmacy offer ranking (haversine).
 * Rows must include pharmacy `lat`, `lng` from DB where available.
 */

const DEFAULT_RADIUS_KM = 120;

/**
 * Great-circle distance in kilometres.
 */
export function haversineKm(lat1, lng1, lat2, lng2) {
  const a1 = Number(lat1);
  const o1 = Number(lng1);
  const a2 = Number(lat2);
  const o2 = Number(lng2);
  if (
    !Number.isFinite(a1) ||
    !Number.isFinite(o1) ||
    !Number.isFinite(a2) ||
    !Number.isFinite(o2) ||
    Math.abs(a1) > 90 ||
    Math.abs(a2) > 90 ||
    Math.abs(o1) > 180 ||
    Math.abs(o2) > 180
  ) {
    return NaN;
  }
  const R = 6371;
  const dLat = ((a2 - a1) * Math.PI) / 180;
  const dLon = ((o2 - o1) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((a1 * Math.PI) / 180) * Math.cos((a2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(Math.max(0, 1 - x)));
  return R * c;
}

export function pharmacyHasReliableCoords(row) {
  const lat = Number(row?.lat);
  const lng = Number(row?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return false;
  if (lat === 0 && lng === 0) return false;
  return true;
}

/**
 * @param {Record<string, string | undefined>} query - req.query
 * @returns {{ lat: number, lng: number } | null}
 */
export function parseUserLatLngFromQuery(query) {
  const rawLat = query.lat ?? query.latitude;
  const rawLng = query.lng ?? query.longitude ?? query.long;
  const lat = Number(rawLat);
  const lng = Number(rawLng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

export function defaultGeoRadiusKm() {
  const n = Number(process.env.COMPARE_GEO_MAX_RADIUS_KM);
  return Number.isFinite(n) && n > 1 && n < 600 ? n : DEFAULT_RADIUS_KM;
}

function parseRadiusOverride(query) {
  const raw = query.radius_km ?? query.radiusKm;
  if (raw === undefined || raw === null || String(raw).trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n > 500) return null;
  return n;
}

/**
 * @param {object[]} rows
 * @param {{ lat:number, lng:number } | null} user
 * @param {Record<string, string | undefined>} query
 */
export function applyGeoToPharmacyOffers(rows, user, query = {}) {
  if (!user) {
    return { rows, geo: null };
  }

  const sortBy = String(query.sort_by || query.sortBy || "").toLowerCase();
  /** When lat/lng present, default sort is distance_then_price unless client asks price-only. */
  const useDistanceSort = sortBy !== "price";

  let radiusKm = parseRadiusOverride(query);
  if (radiusKm == null) radiusKm = defaultGeoRadiusKm();

  const enriched = rows.map((r) => {
    const row = { ...r };
    if (pharmacyHasReliableCoords(r)) {
      const d = haversineKm(user.lat, user.lng, Number(r.lat), Number(r.lng));
      row.distance_km = Math.round(d * 1000) / 1000;
    } else {
      row.distance_km = null;
    }
    return row;
  });

  let out = enriched.filter((r) => r.distance_km == null || r.distance_km <= radiusKm);

  if (useDistanceSort) {
    out = [...out].sort((a, b) => {
      const da = a.distance_km;
      const db = b.distance_km;
      const pa = Number(a.price_inr);
      const pb = Number(b.price_inr);
      if (da == null && db == null) {
        return (Number.isFinite(pa) ? pa : Infinity) - (Number.isFinite(pb) ? pb : Infinity);
      }
      if (da == null) return 1;
      if (db == null) return -1;
      if (Math.abs(da - db) > 1e-6) return da - db;
      return (Number.isFinite(pa) ? pa : Infinity) - (Number.isFinite(pb) ? pb : Infinity);
    });
  }

  return {
    rows: out,
    geo: {
      user_lat: user.lat,
      user_lng: user.lng,
      radius_km: radiusKm,
      sort: useDistanceSort ? "distance_then_price" : "price_only",
    },
  };
}
