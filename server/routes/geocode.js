import { Router } from "express";
import { pool } from "../db/pool.js";

const router = Router();

/** Map common Google locality names → DB slug when names differ */
const LOCALITY_TO_SLUG = {
  bangalore: "bengaluru",
  bengaluru: "bengaluru",
  mumbai: "mumbai",
  bombay: "mumbai",
  delhi: "new-delhi",
  "new delhi": "new-delhi",
};

function normKey(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function extractFromComponents(components) {
  if (!Array.isArray(components)) return {};
  const pick = (...types) => {
    for (const t of types) {
      const c = components.find((x) => x.types?.includes(t));
      if (c?.long_name) return c.long_name;
    }
    return null;
  };
  return {
    locality: pick("locality", "sublocality_level_1", "neighborhood", "administrative_area_level_3"),
    administrative_area_level_2: pick("administrative_area_level_2"),
    administrative_area_level_1: pick("administrative_area_level_1"),
    postal_code: pick("postal_code"),
    country: pick("country"),
    country_code: components.find((x) => x.types?.includes("country"))?.short_name || null,
  };
}

function matchCitySlug(googleParts, cities) {
  const locality = googleParts.locality || googleParts.administrative_area_level_2;
  const state = googleParts.administrative_area_level_1;
  if (!locality && !state) return null;

  const locKey = normKey(locality);
  const aliasSlug = LOCALITY_TO_SLUG[locKey.replace(/\s+/g, " ")];
  if (aliasSlug) {
    const hit = cities.find((c) => c.slug === aliasSlug);
    if (hit) return hit;
  }

  for (const c of cities) {
    const nk = normKey(c.name);
    if (locKey && (locKey === nk || locKey.includes(nk) || nk.includes(locKey))) {
      return c;
    }
    if (locKey && normKey(c.slug).replace(/-/g, " ") === locKey) {
      return c;
    }
  }

  if (state) {
    const sk = normKey(state);
    const byState = cities.filter((c) => normKey(c.state) === sk || sk.includes(normKey(c.state)));
    if (byState.length === 1) return byState[0];
  }

  return null;
}

/**
 * GET /api/geocode/reverse?lat=&lng=
 * Uses Google Geocoding API (server key). Returns address + best DB city match for demo prices.
 */
router.get("/reverse", async (req, res) => {
  const key = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!key) {
    return res.status(503).json({
      error: "Google Geocoding is not configured",
      hint: "Set GOOGLE_MAPS_API_KEY in .env (Geocoding API enabled for the key)",
    });
  }

  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: "lat and lng query params are required" });
  }
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return res.status(400).json({ error: "invalid coordinates" });
  }

  try {
    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    url.searchParams.set("latlng", `${lat},${lng}`);
    url.searchParams.set("key", key);
    url.searchParams.set("language", "en");

    const gRes = await fetch(url.toString());
    const data = await gRes.json();

    if (data.status === "REQUEST_DENIED" || data.status === "INVALID_REQUEST") {
      return res.status(502).json({
        error: data.error_message || `Google Geocoding: ${data.status}`,
      });
    }

    if (data.status !== "OK" || !data.results?.length) {
      return res.json({
        google: null,
        matched_city: null,
        geocode_status: data.status,
        message: "No address found for these coordinates",
      });
    }

    const top = data.results[0];
    const parts = extractFromComponents(top.address_components);
    const { rows: cities } = await pool.query(
      `SELECT id, name, state, slug FROM cities ORDER BY name`
    );
    const matched_city = matchCitySlug(parts, cities);

    return res.json({
      google: {
        formatted_address: top.formatted_address,
        lat,
        lng,
        place_id: top.place_id || null,
        types: top.types || [],
        ...parts,
      },
      matched_city,
      geocode_status: data.status,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || "geocode failed" });
  }
});

export default router;
