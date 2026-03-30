import { parseFirstProductOffer } from "./parseOfferJson.js";

const TIMEOUT_MS = Number(process.env.PARTNER_HTTP_TIMEOUT_MS || 12000);

function buildUrl(base, path, queryParam, q) {
  const url = new URL(path.replace(/^\//, ""), base.endsWith("/") ? base : `${base}/`);
  url.searchParams.set(queryParam, q);
  return url.toString();
}

function applyPostTemplate(template, q) {
  return template
    .replace(/\{\{\s*queryJson\s*\}\}/g, JSON.stringify(q))
    .replace(/\{\{\s*query\s*\}\}/g, () => q.replace(/\\/g, "\\\\").replace(/"/g, '\\"'));
}

/**
 * Calls the partner’s sanctioned HTTP search/catalog endpoint.
 * Contract-specific: base URL, path, auth, and JSON shape come from the partner.
 */
export async function fetchPartnerSearchJson(cfg, query) {
  const q = String(query || "").trim();
  if (!q) throw new Error("empty query");

  const headers = {
    Accept: "application/json",
    ...cfg.extraHeaders,
  };
  if (cfg.auth) {
    headers[cfg.auth.headerName] = cfg.auth.value;
  }

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    let res;
    if (cfg.method === "POST") {
      let body;
      const ctype = (headers["Content-Type"] || headers["content-type"] || "").toLowerCase();
      if (cfg.postBodyTemplate) {
        const raw = applyPostTemplate(cfg.postBodyTemplate, q);
        body = raw;
        if (!ctype) headers["Content-Type"] = "application/json";
      } else {
        body = JSON.stringify({ [cfg.queryParam]: q });
        if (!ctype) headers["Content-Type"] = "application/json";
      }
      const url = new URL(cfg.searchPath.replace(/^\//, ""), cfg.baseUrl.endsWith("/") ? cfg.baseUrl : `${cfg.baseUrl}/`);
      res = await fetch(url.toString(), {
        method: "POST",
        headers,
        body,
        signal: controller.signal,
      });
    } else {
      const url = buildUrl(cfg.baseUrl, cfg.searchPath, cfg.queryParam, q);
      res = await fetch(url, { method: "GET", headers, signal: controller.signal });
    }

    const text = await res.text();
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    }

    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error("Partner response is not JSON");
    }
    return json;
  } finally {
    clearTimeout(t);
  }
}

export function offerFromPartnerJson(json, query) {
  const parsed = parseFirstProductOffer(json, query);
  if (!parsed || parsed.price_inr == null) {
    throw new Error("Could not parse price fields from partner JSON (check response shape)");
  }
  return parsed;
}
