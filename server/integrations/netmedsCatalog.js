/**
 * Netmeds consumer search API (ext/search/application/api/v1.0/products).
 * Copy Authorization (Bearer …) and x-location-detail from DevTools. Fingerprints in browser
 * are optional here — many calls work with Bearer + location + Referer only.
 */

const NETMEDS_SEARCH_URL =
  "https://www.netmeds.com/ext/search/application/api/v1.0/products";
const TIMEOUT_MS = Number(process.env.PARTNER_HTTP_TIMEOUT_MS || 12000);

const DEFAULT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const DEFAULT_LOCATION = {
  country: "INDIA",
  country_iso_code: "IN",
  pincode: "110001",
  city: "Delhi",
  state: "Delhi",
};

export function netmedsCatalogConfigured() {
  const bearer = process.env.NETMEDS_CATALOG_BEARER?.trim();
  const auth = process.env.NETMEDS_CATALOG_AUTHORIZATION?.trim();
  return Boolean(bearer || auth);
}

function authorizationHeader() {
  const raw = process.env.NETMEDS_CATALOG_AUTHORIZATION?.trim();
  if (raw) {
    if (/^bearer\s+/i.test(raw)) return raw;
    return `Bearer ${raw}`;
  }
  const bearer = process.env.NETMEDS_CATALOG_BEARER?.trim();
  if (!bearer) return null;
  if (/^bearer\s+/i.test(bearer)) return bearer;
  return `Bearer ${bearer}`;
}

function locationDetailHeader() {
  const raw = process.env.NETMEDS_CATALOG_LOCATION_JSON?.trim();
  if (raw) {
    try {
      const o = JSON.parse(raw);
      if (o && typeof o === "object") return JSON.stringify(o);
    } catch {
      throw new Error("NETMEDS_CATALOG_LOCATION_JSON must be valid JSON");
    }
  }
  return JSON.stringify(DEFAULT_LOCATION);
}

export async function fetchNetmedsCatalogSearch(query) {
  const auth = authorizationHeader();
  if (!auth) throw new Error("Set NETMEDS_CATALOG_BEARER or NETMEDS_CATALOG_AUTHORIZATION");

  const q = String(query || "").trim();
  if (!q) throw new Error("empty query");

  const pageSize = Math.min(
    48,
    Math.max(4, Number(process.env.NETMEDS_CATALOG_PAGE_SIZE || 12) || 12)
  );

  const url = new URL(NETMEDS_SEARCH_URL);
  url.searchParams.set("page_id", "*");
  url.searchParams.set("page_size", String(pageSize));
  url.searchParams.set("q", q);

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const ua = process.env.NETMEDS_CATALOG_USER_AGENT?.trim() || DEFAULT_UA;
  const locationDetail = locationDetailHeader();
  const refererQ = encodeURIComponent(q);

  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json, text/plain, */*",
        authorization: auth,
        "x-currency-code": "INR",
        "x-location-detail": locationDetail,
        Referer: `https://www.netmeds.com/products/?q=${refererQ}`,
        "User-Agent": ua,
      },
      signal: controller.signal,
    });

    const text = await res.text();
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    }

    return JSON.parse(text);
  } finally {
    clearTimeout(t);
  }
}

/**
 * @returns {{ price_inr: number, mrp_inr: number, title: string | null }}
 */
export function offerFromNetmedsCatalog(json, query) {
  const items = json?.items;
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("No products in Netmeds search results");
  }

  const words = String(query || "")
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 1);

  function score(it) {
    const name = String(it.name || "").toLowerCase();
    let s = 0;
    for (const w of words) {
      if (name.includes(w)) s += 3;
    }
    return s;
  }

  const sorted = [...items].sort((a, b) => score(b) - score(a));
  const best = sorted[0];

  const eff = best?.price?.effective?.min;
  const marked = best?.price?.marked?.min;
  const price_inr = Number(eff);
  const mrp_inr = Number(marked);

  if (!Number.isFinite(price_inr) || price_inr <= 0) {
    throw new Error("Invalid effective price from Netmeds");
  }

  const mrpOk = Number.isFinite(mrp_inr) && mrp_inr > 0 ? mrp_inr : price_inr;

  return {
    price_inr: Math.round(price_inr * 100) / 100,
    mrp_inr: Math.round(Math.max(mrpOk, price_inr) * 100) / 100,
    title: typeof best.name === "string" ? best.name : null,
  };
}

// silence unused import if lint complains — crypto not used, remove