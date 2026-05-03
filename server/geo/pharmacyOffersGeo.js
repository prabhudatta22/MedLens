/**
 * Client-supplied geo for pharmacy offer ranking (haversine).
 * Rows must include pharmacy `lat`, `lng` from DB where available.
 */

const DEFAULT_RADIUS_KM = 120;
const DEFAULT_PREMIUM_CAP_INR = 15;

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

export function defaultPremiumRankCapInr() {
  const n = Number(process.env.COMPARE_PREMIUM_MAX_BIAS_INR);
  return Number.isFinite(n) && n >= 0 && n <= 500 ? n : DEFAULT_PREMIUM_CAP_INR;
}

function parseRadiusOverride(query) {
  const raw = query.radius_km ?? query.radiusKm;
  if (raw === undefined || raw === null || String(raw).trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n > 500) return null;
  return n;
}

function premiumListingActive(row) {
  const tier = String(row.listing_tier || "standard").toLowerCase();
  if (tier === "featured" || tier === "premium") return true;
  const u = row.featured_until ? new Date(row.featured_until).getTime() : 0;
  return Number.isFinite(u) && u > Date.now();
}

function availabilityStalenessBump(row) {
  let b = 0;
  const st = String(row.stock_status || "unknown").toLowerCase();
  if (st === "out_of_stock") b += 1_000_000;
  else if (row.in_stock === false) b += 800_000;
  else if (st === "limited") b += 8;
  else if (st === "unknown") b += 3;
  const obs = row.stock_observed_at ? new Date(row.stock_observed_at).getTime() : 0;
  if (!obs || Date.now() - obs > 14 * 864e5) b += 4;
  return b;
}

function premiumRankBiasInr(row, capInr) {
  if (!premiumListingActive(row)) return 0;
  const w = Number(row.premium_rank_weight);
  const weight = Number.isFinite(w) && w >= 0 ? Math.min(1, w) : 0;
  return Math.min(capInr, weight * capInr);
}

/**
 * Lower score sorts first (cheaper / fresher / less sponsored boost).
 */
export function effectiveOfferSortScore(row, capInr = defaultPremiumRankCapInr()) {
  const pup = Number(row.price_per_unit_inr);
  const pack = Number(row.price_inr);
  const base =
    Number.isFinite(pup) && pup > 0 ? pup : Number.isFinite(pack) && pack > 0 ? pack : Number.POSITIVE_INFINITY;
  return base + availabilityStalenessBump(row) - premiumRankBiasInr(row, capInr);
}

function attachListingMeta(row, capInr) {
  const boost = premiumRankBiasInr(row, capInr);
  const out = { ...row };
  out.sponsored_listing = boost > 0;
  out.listing_boost_inr = Math.round(boost * 10000) / 10000;
  return out;
}

/** When geo is absent, still expose sponsorship fields for transparency. */
export function enrichRowsWithListingTransparency(rows) {
  const capInr = defaultPremiumRankCapInr();
  return rows.map((r) => attachListingMeta({ ...r }, capInr));
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

  const capInr = defaultPremiumRankCapInr();

  const enriched = rows.map((r) => {
    const row = { ...r };
    if (pharmacyHasReliableCoords(r)) {
      const d = haversineKm(user.lat, user.lng, Number(r.lat), Number(r.lng));
      row.distance_km = Math.round(d * 1000) / 1000;
    } else {
      row.distance_km = null;
    }
    return attachListingMeta(row, capInr);
  });

  let out = enriched.filter((r) => r.distance_km == null || r.distance_km <= radiusKm);

  if (useDistanceSort) {
    out = [...out].sort((a, b) => {
      const da = a.distance_km;
      const db = b.distance_km;
      if (da == null && db == null) {
        const sa = effectiveOfferSortScore(a, capInr);
        const sb = effectiveOfferSortScore(b, capInr);
        if (sa !== sb) return sa - sb;
        return (Number(a.price_inr) || 0) - (Number(b.price_inr) || 0);
      }
      if (da == null) return 1;
      if (db == null) return -1;
      if (Math.abs(da - db) > 1e-6) return da - db;
      const sa = effectiveOfferSortScore(a, capInr);
      const sb = effectiveOfferSortScore(b, capInr);
      if (sa !== sb) return sa - sb;
      return (Number(a.price_inr) || 0) - (Number(b.price_inr) || 0);
    });
  } else {
    out = [...out].sort((a, b) => {
      const sa = effectiveOfferSortScore(a, capInr);
      const sb = effectiveOfferSortScore(b, capInr);
      if (sa !== sb) return sa - sb;
      return (Number(a.price_inr) || 0) - (Number(b.price_inr) || 0);
    });
  }

  return {
    rows: out,
    geo: {
      user_lat: user.lat,
      user_lng: user.lng,
      radius_km: radiusKm,
      sort: useDistanceSort ? "distance_then_effective_unit_price" : "effective_unit_price",
      premium_max_bias_inr: capInr,
      note:
        "Effective rank blends per-pack unit price (when present), stock/staleness penalties, and a capped premium listing bias. Set COMPARE_PREMIUM_MAX_BIAS_INR to tune.",
    },
  };
}
