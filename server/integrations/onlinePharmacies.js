import crypto from "node:crypto";
import {
  readPartnerHttpConfig,
  illustrativeFallbackEnabled,
  envPrefixForProvider,
} from "./partners/partnerEnv.js";
import { fetchPartnerSearchJson, offerFromPartnerJson } from "./partners/fetchPartnerSearch.js";
import {
  fetchMedplusCatalogSearch,
  offerFromMedplusCatalog,
  medplusCatalogConfigured,
} from "./medplusCatalog.js";
import {
  fetchApolloCatalogSearch,
  offerFromApolloCatalog,
  apolloCatalogConfigured,
} from "./apolloCatalog.js";
import {
  fetchNetmedsCatalogSearch,
  offerFromNetmedsCatalog,
  netmedsCatalogConfigured,
} from "./netmedsCatalog.js";

/**
 * Online retailer cards + parallel quotes.
 *
 * Live prices: each brand expects a **contractual** HTTP JSON API (base URL + auth) set via env.
 * See `.env.example` and README. There is no universal public “search price” API without keys.
 *
 * Optional dev fallback: ONLINE_USE_ILLUSTRATIVE_FALLBACK=true
 */

export const ONLINE_PROVIDERS = [
  {
    id: "medplusmart",
    label: "MedPlus Mart",
    home: "https://www.medplusmart.com/",
    buildSearchUrl: (q) =>
      `https://www.medplusmart.com/Search/SearchResults?searchText=${encodeURIComponent(q)}`,
  },
  {
    id: "apollopharmacy",
    label: "Apollo Pharmacy",
    home: "https://www.apollopharmacy.in/",
    buildSearchUrl: (q) =>
      `https://www.apollopharmacy.in/search?searchString=${encodeURIComponent(q)}`,
  },
  {
    id: "netmeds",
    label: "Netmeds",
    home: "https://www.netmeds.com/",
    buildSearchUrl: (q) =>
      `https://www.netmeds.com/catalogsearch/result?q=${encodeURIComponent(q)}`,
  },
  {
    id: "1mg",
    label: "Tata 1mg (medicines search)",
    home: "https://www.1mg.com/",
    buildSearchUrl: (q) =>
      `https://www.1mg.com/search/all?name=${encodeURIComponent(q)}`,
  },
  {
    id: "medkart",
    label: "Medkart",
    home: "https://www.medkart.in/",
    buildSearchUrl: (q) =>
      `https://www.medkart.in/search?keyword=${encodeURIComponent(q)}`,
  },
];

function seedNumber(seed) {
  const buf = crypto.createHash("sha256").update(seed).digest();
  return buf.readUInt32BE(0);
}

/** Dev-only deterministic prices when ONLINE_USE_ILLUSTRATIVE_FALLBACK=true */
export function illustrativeQuoteInr(query, providerId, index) {
  const base = seedNumber(`${query}|${providerId}`);
  const packJitter = (base % 80) - 40;
  const tier = 45 + (base % 520) + index * 19 + packJitter;
  const mrp = Math.round(tier * (1.15 + (base % 30) / 100));
  return {
    price_inr: Math.max(1, Math.round(tier)),
    mrp_inr: Math.max(1, mrp),
  };
}

function unconfiguredResponse(provider, q) {
  const prefix = envPrefixForProvider(provider.id) || "PARTNER";
  let hint = `Set ${prefix}_PARTNER_API_BASE (and ${prefix}_PARTNER_BEARER_TOKEN or ${prefix}_PARTNER_API_KEY). Docs: README.md#partner-api-configuration`;
  if (provider.id === "medplusmart") {
    hint += ` Or set MEDPLUS_CATALOG_TOKEN_ID (see README).`;
  }
  if (provider.id === "apollopharmacy") {
    hint += ` Or set APOLLO_CATALOG_AUTHORIZATION (+ optional APOLLO_CATALOG_PINCODE).`;
  }
  if (provider.id === "netmeds") {
    hint += ` Or set NETMEDS_CATALOG_BEARER (+ optional NETMEDS_CATALOG_LOCATION_JSON).`;
  }
  return {
    ok: false,
    provider_id: provider.id,
    label: provider.label,
    website: provider.home,
    search_url: provider.buildSearchUrl(q),
    error: `No sanctioned API configured. ${hint}`,
    data_mode: "unconfigured",
  };
}

function illustrativeResponse(provider, q) {
  const idx = ONLINE_PROVIDERS.findIndex((p) => p.id === provider.id);
  const { price_inr, mrp_inr } = illustrativeQuoteInr(q.toLowerCase(), provider.id, idx);
  return {
    ok: true,
    provider_id: provider.id,
    label: provider.label,
    website: provider.home,
    search_url: provider.buildSearchUrl(q),
    price_inr,
    mrp_inr,
    currency: "INR",
    data_mode: "illustrative_fallback",
  };
}

/**
 * Quote one provider: real partner HTTP when env is set; else unconfigured (or illustrative fallback).
 */
export async function quoteProvider(provider, query) {
  const q = String(query || "").trim();
  if (!q) {
    return {
      ok: false,
      provider_id: provider.id,
      label: provider.label,
      website: provider.home,
      search_url: provider.buildSearchUrl(""),
      error: "empty query",
      data_mode: "error",
    };
  }

  const cfg = readPartnerHttpConfig(provider.id);
  const search_url = provider.buildSearchUrl(q);

  if (cfg) {
    try {
      const json = await fetchPartnerSearchJson(cfg, q);
      const offer = offerFromPartnerJson(json, q);
      return {
        ok: true,
        provider_id: provider.id,
        label: provider.label,
        website: provider.home,
        search_url,
        price_inr: offer.price_inr,
        mrp_inr: offer.mrp_inr,
        product_title: offer.title,
        currency: "INR",
        data_mode: "partner_api",
      };
    } catch (e) {
      return {
        ok: false,
        provider_id: provider.id,
        label: provider.label,
        website: provider.home,
        search_url,
        error: e.message || "partner request failed",
        data_mode: "partner_api_error",
      };
    }
  }

  if (provider.id === "medplusmart" && medplusCatalogConfigured()) {
    try {
      const json = await fetchMedplusCatalogSearch(q);
      const offer = offerFromMedplusCatalog(json, q);
      return {
        ok: true,
        provider_id: provider.id,
        label: provider.label,
        website: provider.home,
        search_url,
        price_inr: offer.price_inr,
        mrp_inr: offer.mrp_inr,
        product_title: offer.title,
        currency: "INR",
        data_mode: "medplus_catalog",
      };
    } catch (e) {
      return {
        ok: false,
        provider_id: provider.id,
        label: provider.label,
        website: provider.home,
        search_url,
        error: e.message || "MedPlus catalog request failed",
        data_mode: "medplus_catalog_error",
      };
    }
  }

  if (provider.id === "apollopharmacy" && apolloCatalogConfigured()) {
    try {
      const json = await fetchApolloCatalogSearch(q);
      const offer = offerFromApolloCatalog(json, q);
      return {
        ok: true,
        provider_id: provider.id,
        label: provider.label,
        website: provider.home,
        search_url,
        price_inr: offer.price_inr,
        mrp_inr: offer.mrp_inr,
        product_title: offer.title,
        currency: "INR",
        data_mode: "apollo_catalog",
      };
    } catch (e) {
      return {
        ok: false,
        provider_id: provider.id,
        label: provider.label,
        website: provider.home,
        search_url,
        error: e.message || "Apollo catalog request failed",
        data_mode: "apollo_catalog_error",
      };
    }
  }

  if (provider.id === "netmeds" && netmedsCatalogConfigured()) {
    try {
      const json = await fetchNetmedsCatalogSearch(q);
      const offer = offerFromNetmedsCatalog(json, q);
      return {
        ok: true,
        provider_id: provider.id,
        label: provider.label,
        website: provider.home,
        search_url,
        price_inr: offer.price_inr,
        mrp_inr: offer.mrp_inr,
        product_title: offer.title,
        currency: "INR",
        data_mode: "netmeds_catalog",
      };
    } catch (e) {
      return {
        ok: false,
        provider_id: provider.id,
        label: provider.label,
        website: provider.home,
        search_url,
        error: e.message || "Netmeds catalog request failed",
        data_mode: "netmeds_catalog_error",
      };
    }
  }

  if (illustrativeFallbackEnabled()) {
    return illustrativeResponse(provider, q);
  }

  return unconfiguredResponse(provider, q);
}

export async function quoteAllProvidersParallel(query) {
  const started = Date.now();
  const results = await Promise.all(ONLINE_PROVIDERS.map((p) => quoteProvider(p, query)));
  const elapsed_ms = Date.now() - started;
  return { results, elapsed_ms };
}
