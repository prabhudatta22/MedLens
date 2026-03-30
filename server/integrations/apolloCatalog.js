/**
 * Apollo Pharmacy / Apollo 247 search API (consumer; same origin as apollopharmacy.in).
 * Copy Authorization header value from DevTools → Network → v4/search (not necessarily "Bearer …").
 *
 * Env: APOLLO_CATALOG_AUTHORIZATION, APOLLO_CATALOG_PINCODE (optional, default 400001)
 */

import crypto from "node:crypto";

const APOLLO_SEARCH_BASE = "https://search.apollo247.com/v4/search";
const TIMEOUT_MS = Number(process.env.PARTNER_HTTP_TIMEOUT_MS || 12000);

const DEFAULT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

export function apolloCatalogConfigured() {
  return Boolean(process.env.APOLLO_CATALOG_AUTHORIZATION?.trim());
}

export async function fetchApolloCatalogSearch(query) {
  const auth = process.env.APOLLO_CATALOG_AUTHORIZATION?.trim();
  if (!auth) throw new Error("APOLLO_CATALOG_AUTHORIZATION is not set");

  const q = String(query || "").trim();
  if (!q) throw new Error("empty query");

  const pincode = (process.env.APOLLO_CATALOG_PINCODE || "400001").toString().trim().replace(/^undefined$/i, "400001");
  const url = new URL(APOLLO_SEARCH_BASE);
  url.searchParams.set("query", q);
  url.searchParams.set("pincode", pincode);

  const sessionId = crypto.randomUUID();
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const ua = process.env.APOLLO_CATALOG_USER_AGENT?.trim() || DEFAULT_UA;

  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json, text/plain, */*",
        authorization: auth,
        "x-app-os": "web",
        "x-source-service": "PHARMA_AP_IN",
        "x-token": "",
        "x-unique-session-id": sessionId,
        Referer: "https://www.apollopharmacy.in/search-medicines?source=%2F",
        "User-Agent": ua,
      },
      signal: controller.signal,
    });

    const text = await res.text();
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    }

    const json = JSON.parse(text);
    if (json.errorCode != null && Number(json.errorCode) !== 0) {
      throw new Error(json.errorMsg || `Apollo errorCode ${json.errorCode}`);
    }
    return json;
  } finally {
    clearTimeout(t);
  }
}

/**
 * @returns {{ price_inr: number, mrp_inr: number, title: string | null }}
 */
export function offerFromApolloCatalog(json, query) {
  const products = json?.data?.productDetails?.products;
  if (!Array.isArray(products) || products.length === 0) {
    throw new Error("No products in Apollo search results");
  }

  const words = String(query || "")
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 1);

  function score(p) {
    const name = String(p.name || "").toLowerCase();
    let s = 0;
    for (const w of words) {
      if (name.includes(w)) s += 3;
    }
    if (p.status === "in-stock") s += 0.5;
    return s;
  }

  const sorted = [...products].sort((a, b) => score(b) - score(a));
  const best = sorted[0];

  const list = Number(best.price);
  const sell = Number(best.specialPrice);
  const hasSell = Number.isFinite(sell) && sell > 0;
  const hasList = Number.isFinite(list) && list > 0;
  if (!hasSell && !hasList) {
    throw new Error("Invalid price fields from Apollo");
  }
  const price_inr = Math.round((hasSell ? sell : list) * 100) / 100;
  const mrp_inr = Math.round((hasList ? Math.max(list, price_inr) : price_inr) * 100) / 100;

  return {
    price_inr,
    mrp_inr,
    title: typeof best.name === "string" ? best.name : null,
  };
}
