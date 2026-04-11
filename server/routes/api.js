import { Router } from "express";
import { pool } from "../db/pool.js";
import multer from "multer";
import { ocrImageBytes } from "../ocr/ocr.js";
import { matchMedicinesFromText } from "../prescription/parse.js";
import { normalizeQuery } from "../ai/normalize.js";
import { matchLabTestsFromText } from "../labs/parse.js";
import {
  getPartnerPackageDetails,
  isDiagnosticsPartnerEnabled,
  searchPartnerPackages,
} from "../integrations/diagnosticsPartner.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const asyncHandler =
  (fn) =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

function normalizeCitySlug(slug) {
  const s = (slug || "").toString().trim().toLowerCase();
  if (!s) return "";
  const alias = {
    bangalore: "bengaluru",
    bengalore: "bengaluru",
    "new delhi": "new-delhi",
    delhi: "new-delhi",
  };
  return alias[s] || s.replace(/\s+/g, "-");
}

function mapPartnerPackageToLabRow(pkg) {
  return {
    id: pkg.package_id,
    heading: pkg.heading,
    sub_heading: pkg.sub_heading,
    category: pkg.category || "PATHOLOGY",
    icon_url: null,
    slug: pkg.slug || "",
    report_tat_hours: pkg.report_tat_hours,
    home_collection: pkg.home_collection !== false,
    lab_name: pkg.lab_name || "Healthians",
    price_inr: pkg.price_inr,
    mrp_inr: pkg.mrp_inr,
    provider: "healthians",
    package_id: pkg.package_id,
    deal_id: pkg.deal_id || pkg.package_id,
    product_type: pkg.product_type || "",
    product_type_id: pkg.product_type_id || "",
    city_id: pkg.city_id || null,
    city_name: pkg.city_name || "",
    tests_included: pkg.tests_included || [],
  };
}

router.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, db: "up" });
  } catch (e) {
    res.status(503).json({ ok: false, db: "down", error: e.message });
  }
});

router.get(
  "/cities",
  asyncHandler(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT id, name, state, slug FROM cities ORDER BY name`
  );
  res.json({ cities: rows });
  })
);

router.get(
  "/normalize",
  asyncHandler(async (req, res) => {
    const q = (req.query.q || "").toString().slice(0, 200);
    const out = await normalizeQuery(q);
    res.json(out);
  })
);

router.get(
  "/medicines/search",
  asyncHandler(async (req, res) => {
  const q = (req.query.q || "").toString().trim().slice(0, 120);
  if (!q) {
    return res.json({ medicines: [] });
  }
  const like = `%${q.toLowerCase()}%`;
  const { rows } = await pool.query(
    `SELECT id, display_name, generic_name, strength, form, pack_size, schedule
     FROM medicines
     WHERE search_vector LIKE $1
     ORDER BY display_name
     LIMIT 30`,
    [like]
  );
  res.json({ medicines: rows });
  })
);

// OCR prescription/bill (printed) -> best matching medicines from DB
router.post(
  "/prescription/ocr",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file?.buffer) return res.status(400).json({ error: "Missing file (field name: file)" });
    const text = await ocrImageBytes(req.file.buffer);
    const matches = await matchMedicinesFromText(text, { limitItems: 10 });
    res.json({ ok: true, text, matches });
  })
);

// ---- Diagnostics / labs (demo) ----
router.post(
  "/labs/prescription/ocr",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    const citySlug = normalizeCitySlug(req.query.city);
    if (!citySlug) return res.status(400).json({ error: "city slug is required (e.g. mumbai)" });
    if (!req.file?.buffer) return res.status(400).json({ error: "Missing file (field name: file)" });
    const text = await ocrImageBytes(req.file.buffer);
    const matches = await matchLabTestsFromText(text, { limitItems: 10, citySlug });
    res.json({ ok: true, text, matches });
  })
);

router.get(
  "/labs/categories",
  asyncHandler(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT DISTINCT category FROM lab_tests ORDER BY category`
  );
  res.json({ categories: rows.map((r) => r.category) });
  })
);

// Lightweight intent helper for diagnostics search box
router.get(
  "/labs/intent",
  asyncHandler(async (req, res) => {
    const q = (req.query.q || "").toString().trim().slice(0, 120).toLowerCase();
    const citySlug = normalizeCitySlug(req.query.city);
    if (!citySlug) {
      return res.status(400).json({ error: "city slug is required (e.g. mumbai)" });
    }
    if (!q || q.length < 2) {
      return res.json({ query: q, city: citySlug, intents: [], suggestions: [] });
    }

    const intents = [];
    const has = (re) => re.test(q);

    if (has(/\b(thyroid|tsh|t3|t4)\b/)) intents.push({ id: "thyroid", label: "Thyroid" });
    if (has(/\b(cbc|blood count|hemogram)\b/)) intents.push({ id: "cbc", label: "CBC / blood count" });
    if (has(/\b(lipid|cholesterol)\b/)) intents.push({ id: "lipid", label: "Lipid / cholesterol" });
    if (has(/\b(diabetes|hba1c|glucose|sugar)\b/)) intents.push({ id: "diabetes", label: "Diabetes / glucose" });
    if (has(/\b(full body|health check|checkup)\b/)) intents.push({ id: "full_body", label: "Full body checkup" });
    if (has(/\b(vitamin d|vit d)\b/)) intents.push({ id: "vitd", label: "Vitamin D" });
    if (has(/\b(vitamin b12|b12)\b/)) intents.push({ id: "b12", label: "Vitamin B12" });

    // Suggest a few best matches from DB, using the existing search_vector
    const like = `%${q}%`;
    const { rows } = await pool.query(
      `SELECT
        t.id,
        t.heading,
        t.sub_heading,
        t.category,
        t.slug,
        p.lab_name,
        p.price_inr,
        p.mrp_inr
       FROM lab_tests t
       JOIN cities c ON c.slug = $2
       JOIN lab_test_prices p ON p.test_id = t.id AND p.city_id = c.id
       WHERE t.search_vector LIKE $1
       ORDER BY p.price_inr ASC NULLS LAST
       LIMIT 8`,
      [like, citySlug]
    );

    res.json({ query: q, city: citySlug, intents, suggestions: rows });
  })
);

/**
 * GET /api/labs/search?q=cbc&city=mumbai&category=PATHOLOGY
 * Returns lab tests + price for that city (demo data).
 */
router.get(
  "/labs/search",
  asyncHandler(async (req, res) => {
  const q = (req.query.q || "").toString().trim().slice(0, 120);
  const citySlug = normalizeCitySlug(req.query.city);
  const pincode = (req.query.pincode || "").toString().trim().slice(0, 10);
  const category = (req.query.category || "").toString().trim().toUpperCase();
  if (!citySlug) {
    return res.status(400).json({ error: "city slug is required (e.g. mumbai)" });
  }
  if (!q || q.length < 2) {
    return res.json({ query: q, city: citySlug, items: [] });
  }

  if (isDiagnosticsPartnerEnabled()) {
    try {
      const partner = await searchPartnerPackages({
        query: q,
        city: citySlug,
        category,
        pincode,
      });
      const items = (partner.packages || []).map(mapPartnerPackageToLabRow);
      return res.json({
        query: q,
        city: citySlug,
        source: "partner",
        partner: "healthians",
        items,
      });
    } catch (e) {
      // Fall back to local DB search if partner API is temporarily unavailable.
      console.error("Diagnostics partner search failed, falling back to local catalog:", e?.message || e);
    }
  }

  const like = `%${q.toLowerCase()}%`;
  const params = [like, citySlug];
  let catSql = "";
  if (category === "PATHOLOGY" || category === "RADIOLOGY") {
    params.push(category);
    catSql = " AND t.category = $3";
  }

  const { rows } = await pool.query(
    `SELECT
      t.id,
      t.heading,
      t.sub_heading,
      t.category,
      t.icon_url,
      t.slug,
      t.report_tat_hours,
      t.home_collection,
      p.lab_name,
      p.price_inr,
      p.mrp_inr
     FROM lab_tests t
     JOIN cities c ON c.slug = $2
     JOIN lab_test_prices p ON p.test_id = t.id AND p.city_id = c.id
     WHERE t.search_vector LIKE $1${catSql}
     ORDER BY p.price_inr ASC NULLS LAST
     LIMIT 60`,
    params
  );

  res.json({ query: q, city: citySlug, items: rows });
  })
);

router.get(
  "/labs/package/:packageId",
  asyncHandler(async (req, res) => {
    const packageId = (req.params.packageId || "").toString().trim();
    const citySlug = normalizeCitySlug(req.query.city);
    const pincode = (req.query.pincode || "").toString().trim().slice(0, 10);
    if (!packageId) return res.status(400).json({ error: "packageId is required" });
    if (!citySlug) return res.status(400).json({ error: "city slug is required (e.g. mumbai)" });

    if (isDiagnosticsPartnerEnabled()) {
      const pkg = await getPartnerPackageDetails({ packageId, city: citySlug, pincode, category: "" });
      if (!pkg) return res.status(404).json({ error: "Package not found" });
      return res.json({
        source: "partner",
        partner: "healthians",
        item: mapPartnerPackageToLabRow(pkg),
      });
    }

    const numericId = Number(packageId);
    if (!Number.isFinite(numericId) || numericId < 1) {
      return res.status(404).json({ error: "Package not found" });
    }

    const { rows } = await pool.query(
      `SELECT
         t.id,
         t.heading,
         t.sub_heading,
         t.category,
         t.icon_url,
         t.slug,
         t.report_tat_hours,
         t.home_collection,
         p.lab_name,
         p.price_inr,
         p.mrp_inr
       FROM lab_tests t
       JOIN cities c ON c.slug = $2
       JOIN lab_test_prices p ON p.test_id = t.id AND p.city_id = c.id
       WHERE t.id = $1
       LIMIT 1`,
      [numericId, citySlug]
    );
    if (!rows.length) return res.status(404).json({ error: "Package not found" });
    return res.json({ source: "local", item: rows[0] });
  })
);

router.get(
  "/compare",
  asyncHandler(async (req, res) => {
  const medicineId = Number(req.query.medicineId);
  const citySlug = (req.query.city || "").toString().trim().toLowerCase();
  if (!Number.isFinite(medicineId) || medicineId < 1) {
    return res.status(400).json({ error: "medicineId is required" });
  }
  if (!citySlug) {
    return res.status(400).json({ error: "city slug is required (e.g. mumbai)" });
  }

  const { rows } = await pool.query(
    `SELECT
       pp.id AS price_id,
       pp.price_inr,
       pp.mrp_inr,
       pp.in_stock,
       pp.price_type,
       pp.updated_at,
       p.id AS pharmacy_id,
       p.name AS pharmacy_name,
       p.chain,
       p.address_line,
       p.pincode,
       p.lat,
       p.lng,
       c.name AS city_name,
       c.state,
       m.id AS medicine_id,
       m.display_name,
       m.strength,
       m.form,
       m.pack_size
     FROM pharmacy_prices pp
     JOIN pharmacies p ON p.id = pp.pharmacy_id
     JOIN cities c ON c.id = p.city_id
     JOIN medicines m ON m.id = pp.medicine_id
     WHERE pp.medicine_id = $1 AND c.slug = $2 AND pp.price_type = 'retail'
     ORDER BY pp.price_inr ASC NULLS LAST`,
    [medicineId, citySlug]
  );

  const prices = rows.map((r) => Number(r.price_inr));
  const min = prices.length ? Math.min(...prices) : null;
  const max = prices.length ? Math.max(...prices) : null;
  let spreadPct = null;
  if (min != null && max != null && max > 0 && min < max) {
    spreadPct = Math.round(((max - min) / max) * 1000) / 10;
  }

  res.json({
    medicineId,
    city: citySlug,
    stats: { min_inr: min, max_inr: max, spread_percent: spreadPct },
    offers: rows,
  });
  })
);

/** Realtime local match: pharmacies in city whose stocked medicine name/generic contains q */
router.get("/compare/search", async (req, res) => {
  const q = (req.query.q || "").toString().trim().slice(0, 120);
  const citySlug = (req.query.city || "").toString().trim().toLowerCase();
  if (!citySlug) {
    return res.status(400).json({ error: "city slug is required (e.g. mumbai)" });
  }
  if (!q || q.length < 2) {
    return res.json({
      query: q,
      city: citySlug,
      stats: { min_inr: null, max_inr: null, spread_percent: null },
      offers: [],
    });
  }
  const like = `%${q.toLowerCase()}%`;
  const { rows } = await pool.query(
    `SELECT
       pp.id AS price_id,
       pp.price_inr,
       pp.mrp_inr,
       pp.in_stock,
       pp.price_type,
       pp.updated_at,
       p.id AS pharmacy_id,
       p.name AS pharmacy_name,
       p.chain,
       p.address_line,
       p.pincode,
       p.lat,
       p.lng,
       c.name AS city_name,
       c.state,
       m.id AS medicine_id,
       m.display_name,
       m.strength,
       m.form,
       m.pack_size
     FROM pharmacy_prices pp
     JOIN pharmacies p ON p.id = pp.pharmacy_id
     JOIN cities c ON c.id = p.city_id
     JOIN medicines m ON m.id = pp.medicine_id
     WHERE c.slug = $2
       AND pp.price_type = 'retail'
       AND (
         LOWER(m.display_name) LIKE $1
         OR LOWER(COALESCE(m.generic_name, '')) LIKE $1
       )
     ORDER BY pp.price_inr ASC NULLS LAST
     LIMIT 120`,
    [like, citySlug]
  );

  const prices = rows.map((r) => Number(r.price_inr)).filter((n) => Number.isFinite(n));
  const min = prices.length ? Math.min(...prices) : null;
  const max = prices.length ? Math.max(...prices) : null;
  let spreadPct = null;
  if (min != null && max != null && max > 0 && min < max) {
    spreadPct = Math.round(((max - min) / max) * 1000) / 10;
  }

  res.json({
    query: q,
    city: citySlug,
    stats: { min_inr: min, max_inr: max, spread_percent: spreadPct },
    offers: rows,
  });
});

/**
 * GET /api/compare/by-pincode?q=metformin&pincode=400050&city=mumbai
 * Pilot DB prices: filter by 6-digit PIN (optional) and/or city slug.
 * At least one of pincode (6 digits) or city is required.
 */
router.get(
  "/compare/by-pincode",
  asyncHandler(async (req, res) => {
    const q = (req.query.q || "").toString().trim().slice(0, 120);
    const citySlug = (req.query.city || "").toString().trim().toLowerCase();
    const pinDigits = (req.query.pincode || "").toString().replace(/\D/g, "").slice(0, 6);
    const pinParam = pinDigits.length === 6 ? pinDigits : null;
    const cityParam = citySlug || null;

    if (!pinParam && !cityParam) {
      return res
        .status(400)
        .json({ error: "Enter a 6-digit PIN code and/or select a city for database compare." });
    }

    if (!q || q.length < 2) {
      const emptyStats = { min_inr: null, max_inr: null, spread_percent: null };
      return res.json({
        source: "db",
        query: q,
        pincode: pinParam,
        city: cityParam,
        filter_label: [pinParam ? `PIN ${pinParam}` : null, cityParam ? `City ${cityParam}` : null]
          .filter(Boolean)
          .join(" · "),
        stats: emptyStats,
        offers: [],
      });
    }

    const like = `%${q.toLowerCase()}%`;
    const { rows } = await pool.query(
      `SELECT
         pp.id AS price_id,
         pp.price_inr,
         pp.mrp_inr,
         pp.in_stock,
         pp.price_type,
         pp.updated_at,
         p.id AS pharmacy_id,
         p.name AS pharmacy_name,
         p.chain,
         p.address_line,
         p.pincode,
         p.lat,
         p.lng,
         c.name AS city_name,
         c.state,
         m.id AS medicine_id,
         m.display_name,
         m.strength,
         m.form,
         m.pack_size
       FROM pharmacy_prices pp
       JOIN pharmacies p ON p.id = pp.pharmacy_id
       JOIN cities c ON c.id = p.city_id
       JOIN medicines m ON m.id = pp.medicine_id
       WHERE pp.price_type = 'retail'
         AND ($2::text IS NULL OR regexp_replace(COALESCE(p.pincode, ''), '[^0-9]', '', 'g') = $2)
         AND ($3::text IS NULL OR $3 = '' OR c.slug = $3)
         AND (
           LOWER(m.display_name) LIKE $1
           OR LOWER(COALESCE(m.generic_name, '')) LIKE $1
         )
       ORDER BY pp.price_inr ASC NULLS LAST
       LIMIT 120`,
      [like, pinParam, cityParam]
    );

    const prices = rows.map((r) => Number(r.price_inr)).filter((n) => Number.isFinite(n));
    const min = prices.length ? Math.min(...prices) : null;
    const max = prices.length ? Math.max(...prices) : null;
    let spreadPct = null;
    if (min != null && max != null && max > 0 && min < max) {
      spreadPct = Math.round(((max - min) / max) * 1000) / 10;
    }

    const filterLabel = [pinParam ? `PIN ${pinParam}` : null, cityParam ? `City ${cityParam}` : null]
      .filter(Boolean)
      .join(" · ");

    res.json({
      source: "db",
      query: q,
      pincode: pinParam,
      city: cityParam,
      filter_label: filterLabel || "Database",
      stats: { min_inr: min, max_inr: max, spread_percent: spreadPct },
      offers: rows,
    });
  })
);

router.get("/carts/:id", async (req, res) => {
  const cartId = Number(req.params.id);
  if (!Number.isFinite(cartId) || cartId < 1) {
    return res.status(400).json({ error: "invalid cart id" });
  }
  const cartRes = await pool.query(
    `SELECT id, source, source_ref, status, ocr_text, created_at
     FROM carts
     WHERE id = $1`,
    [cartId]
  );
  if (!cartRes.rows.length) return res.status(404).json({ error: "not found" });

  const itemsRes = await pool.query(
    `SELECT
       ci.id,
       ci.quantity,
       ci.match_score,
       ci.match_line,
       m.id AS medicine_id,
       m.display_name,
       m.generic_name,
       m.strength,
       m.form,
       m.pack_size
     FROM cart_items ci
     JOIN medicines m ON m.id = ci.medicine_id
     WHERE ci.cart_id = $1
     ORDER BY ci.match_score DESC NULLS LAST`,
    [cartId]
  );

  res.json({ cart: cartRes.rows[0], items: itemsRes.rows });
});

router.get("/carts/:id/compare", async (req, res) => {
  const cartId = Number(req.params.id);
  const citySlug = (req.query.city || "").toString().trim().toLowerCase();
  if (!Number.isFinite(cartId) || cartId < 1) {
    return res.status(400).json({ error: "invalid cart id" });
  }
  if (!citySlug) {
    return res.status(400).json({ error: "city slug is required (e.g. mumbai)" });
  }

  const cartExists = await pool.query(`SELECT 1 FROM carts WHERE id = $1 LIMIT 1`, [cartId]);
  if (!cartExists.rows.length) {
    return res.status(404).json({ error: "not found" });
  }

  // For each cart item, compute min/max across pharmacies in the city,
  // and also return the cheapest (rank=1) pharmacy row.
  const { rows } = await pool.query(
    `WITH city AS (
       SELECT id, slug FROM cities WHERE slug = $2
     ),
     offers AS (
       SELECT
         ci.cart_id,
         ci.medicine_id,
         ci.quantity,
         ci.match_score,
         ci.match_line,
         m.display_name,
         m.generic_name,
         m.strength,
         m.form,
         m.pack_size,
         pp.price_inr,
         pp.mrp_inr,
         pp.updated_at,
         p.id AS pharmacy_id,
         p.name AS pharmacy_name,
         p.chain,
         p.address_line,
         p.pincode,
         MIN(pp.price_inr) OVER (PARTITION BY ci.medicine_id) AS min_inr,
         MAX(pp.price_inr) OVER (PARTITION BY ci.medicine_id) AS max_inr,
         ROW_NUMBER() OVER (PARTITION BY ci.medicine_id ORDER BY pp.price_inr ASC NULLS LAST) AS price_rank
       FROM cart_items ci
       JOIN medicines m ON m.id = ci.medicine_id
       LEFT JOIN pharmacies p
         ON p.city_id = (SELECT id FROM city)
       LEFT JOIN pharmacy_prices pp
         ON pp.pharmacy_id = p.id
        AND pp.medicine_id = ci.medicine_id
        AND pp.price_type = 'retail'
       WHERE ci.cart_id = $1
     )
     SELECT *
     FROM offers
     WHERE price_rank = 1 OR price_rank IS NULL
     ORDER BY match_score DESC NULLS LAST`,
    [cartId, citySlug]
  );

  // Compute spread_percent safely in JS (min/max can be null).
  const items = rows.map((r) => {
    const min = r.min_inr != null ? Number(r.min_inr) : null;
    const max = r.max_inr != null ? Number(r.max_inr) : null;
    let spreadPct = null;
    if (min != null && max != null && max > 0 && min < max) {
      spreadPct = Math.round(((max - min) / max) * 1000) / 10;
    }
    return {
      cart_id: r.cart_id,
      medicine_id: r.medicine_id,
      quantity: r.quantity,
      match_score: r.match_score,
      match_line: r.match_line,
      display_name: r.display_name,
      generic_name: r.generic_name,
      strength: r.strength,
      form: r.form,
      pack_size: r.pack_size,
      best: r.price_rank ? {
        price_inr: r.price_inr,
        mrp_inr: r.mrp_inr,
        updated_at: r.updated_at,
        pharmacy_id: r.pharmacy_id,
        pharmacy_name: r.pharmacy_name,
        chain: r.chain,
        address_line: r.address_line,
        pincode: r.pincode,
      } : null,
      stats: { min_inr: min, max_inr: max, spread_percent: spreadPct },
    };
  });

  res.json({ cartId, city: citySlug, items });
});

router.use((err, _req, res, _next) => {
  // Avoid crashing the process on DB/network errors from async routes.
  const msg = err?.message || "internal error";
  const status =
    String(msg).includes("ECONNREFUSED") || String(msg).includes("DATABASE_URL")
      ? 503
      : 500;
  console.error(err);
  res.status(status).json({
    error: status === 503 ? "Database unavailable" : "Server error",
    detail: msg,
  });
});

export default router;
