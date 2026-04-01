import { Router } from "express";
import { pool } from "../db/pool.js";

const router = Router();

const asyncHandler =
  (fn) =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * GET /api/catalog/skus?q=met
 * Uses idx_sku_name (btree on name); prefix/substring match in SQL.
 */
router.get(
  "/skus",
  asyncHandler(async (req, res) => {
    const q = (req.query.q || "").toString().trim().slice(0, 200);
    if (!q) {
      const { rows } = await pool.query(
        `SELECT id, name, details, category, created_at
         FROM skus
         ORDER BY name
         LIMIT 50`
      );
      return res.json({ skus: rows });
    }
    const like = `%${q}%`;
    const { rows } = await pool.query(
      `SELECT id, name, details, category, created_at
       FROM skus
       WHERE name ILIKE $1
       ORDER BY name
       LIMIT 50`,
      [like]
    );
    res.json({ query: q, skus: rows });
  })
);

/**
 * GET /api/catalog/skus/:id
 */
router.get(
  "/skus/:id",
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    if (!UUID_RE.test(id)) {
      return res.status(400).json({ error: "invalid sku id" });
    }
    const { rows } = await pool.query(
      `SELECT id, name, details, category, created_at FROM skus WHERE id = $1`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: "sku not found" });
    res.json({ sku: rows[0] });
  })
);

/**
 * GET /api/catalog/skus/:id/providers
 * Provider offers for a SKU (uses idx_price_lookup on sku_id, price).
 */
router.get(
  "/skus/:id/providers",
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    if (!UUID_RE.test(id)) {
      return res.status(400).json({ error: "invalid sku id" });
    }
    const { rows } = await pool.query(
      `SELECT
         ps.id AS provider_sku_id,
         ps.price,
         ps.discount,
         ps.final_price,
         ps.availability,
         ps.updated_at,
         sp.id AS service_provider_id,
         sp.name AS provider_name,
         sp.address,
         sp.area,
         sp.city,
         sp.state,
         sp.pincode
       FROM provider_skus ps
       JOIN service_providers sp ON sp.id = ps.service_provider_id
       WHERE ps.sku_id = $1
       ORDER BY ps.price ASC NULLS LAST`,
      [id]
    );
    res.json({ skuId: id, offers: rows });
  })
);

/**
 * GET /api/catalog/users
 * Demo: UUID consumer profiles (table catalog_users; OTP auth uses integer users).
 */
router.get(
  "/users",
  asyncHandler(async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT id, username, phone_number, address, area, city, state, pincode, created_at
       FROM catalog_users
       ORDER BY username`
    );
    res.json({ users: rows });
  })
);

router.use((err, _req, res, _next) => {
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
