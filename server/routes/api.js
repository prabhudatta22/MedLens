import { Router } from "express";
import { pool } from "../db/pool.js";

const router = Router();

router.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, db: "up" });
  } catch (e) {
    res.status(503).json({ ok: false, db: "down", error: e.message });
  }
});

router.get("/cities", async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT id, name, state, slug FROM cities ORDER BY name`
  );
  res.json({ cities: rows });
});

router.get("/medicines/search", async (req, res) => {
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
});

router.get("/compare", async (req, res) => {
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
});

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

export default router;
