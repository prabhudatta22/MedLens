/**
 * MedPlus Mart consumer catalog search (same endpoint their site calls).
 * searchCriteria.searchQuery is base64("A::" + plain query). Params tokenId + timeStapm (API spelling) are required.
 *
 * Set MEDPLUS_CATALOG_TOKEN_ID from DevTools → Network → copy tokenId from a getProductSearch request.
 * Tokens can expire; refresh when requests return 403/HTML.
 */

const MEDPLUS_CATALOG_ORIGIN = "https://www.medplusmart.com";
const MEDPLUS_CATALOG_PATH = "/mart-catalog-api/getProductSearch";

const TIMEOUT_MS = Number(process.env.PARTNER_HTTP_TIMEOUT_MS || 12000);

const DEFAULT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

export function medplusCatalogConfigured() {
  return Boolean(process.env.MEDPLUS_CATALOG_TOKEN_ID?.trim());
}

function encodeSearchQuery(q) {
  return Buffer.from(`A::${String(q).trim()}`, "utf8").toString("base64");
}

/**
 * @returns {Promise<object>} Parsed JSON body
 */
export async function fetchMedplusCatalogSearch(query) {
  const tokenId = process.env.MEDPLUS_CATALOG_TOKEN_ID?.trim();
  if (!tokenId) throw new Error("MEDPLUS_CATALOG_TOKEN_ID is not set");

  const q = String(query || "").trim();
  if (!q) throw new Error("empty query");

  const recordsCount = Math.min(
    50,
    Math.max(5, Number(process.env.MEDPLUS_CATALOG_PAGE_SIZE || 15) || 15)
  );

  const searchCriteria = JSON.stringify({
    searchQuery: encodeSearchQuery(q),
    pageNumber: 1,
    recordsCount,
    allFieldsRequired: true,
  });

  const url = new URL(MEDPLUS_CATALOG_PATH, MEDPLUS_CATALOG_ORIGIN);
  url.searchParams.set("searchCriteria", searchCriteria);
  url.searchParams.set("tokenId", tokenId);
  url.searchParams.set("timeStapm", new Date().toISOString());

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const ua = process.env.MEDPLUS_CATALOG_USER_AGENT?.trim() || DEFAULT_UA;

  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json, text/plain, */*",
        "X-Requested-With": "XMLHttpRequest",
        Referer: `${MEDPLUS_CATALOG_ORIGIN}/`,
        "User-Agent": ua,
      },
      signal: controller.signal,
    });

    const text = await res.text();
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    }

    const trimmed = text.trim();
    if (trimmed.startsWith("<") || !trimmed.startsWith("{")) {
      throw new Error("MedPlus returned non-JSON (403/token expired? Refresh MEDPLUS_CATALOG_TOKEN_ID)");
    }

    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error("MedPlus response is not JSON");
    }

    if (json?.statusCode && String(json.statusCode).toUpperCase() !== "SUCCESS") {
      throw new Error(`MedPlus statusCode: ${json.statusCode}`);
    }

    return json;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Pick best-matching product from catalog JSON; uses pack MRP as listed price.
 * @returns {{ price_inr: number, mrp_inr: number, title: string | null, product_id: string | null }}
 */
export function offerFromMedplusCatalog(json, query) {
  const products = json?.dataObject?.productResponse;
  if (!Array.isArray(products) || products.length === 0) {
    throw new Error("No products in MedPlus search results");
  }

  const words = String(query || "")
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 1);

  function score(p) {
    const name = String(p.productName || "").toLowerCase();
    let s = 0;
    for (const w of words) {
      if (name.includes(w)) s += 3;
    }
    if (p.inStock === true) s += 0.5;
    return s;
  }

  const sorted = [...products].sort((a, b) => score(b) - score(a));
  const best = sorted[0];
  const mrp = Number(best.packSizeMrp);
  if (!Number.isFinite(mrp) || mrp <= 0) {
    throw new Error("Invalid packSizeMrp from MedPlus");
  }
  const rounded = Math.round(mrp * 100) / 100;

  return {
    price_inr: rounded,
    mrp_inr: rounded,
    title: typeof best.productName === "string" ? best.productName : null,
    product_id: typeof best.productId === "string" ? best.productId : null,
  };
}
