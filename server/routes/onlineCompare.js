import { Router } from "express";
import { quoteAllProvidersParallel } from "../integrations/onlinePharmacies.js";
import { pool } from "../db/pool.js";

const router = Router();

/**
 * GET /api/online/compare?q=metformin&medicineId=1
 * Runs all online providers in parallel (real HTTP when partner env is set).
 */
router.get("/compare", async (req, res) => {
  const medicineId = req.query.medicineId != null ? Number(req.query.medicineId) : null;
  const qParam = (req.query.q || "").toString().trim();

  let queryText = qParam;
  if (medicineId != null && Number.isFinite(medicineId) && medicineId >= 1) {
    try {
      const { rows } = await pool.query(
        `SELECT display_name, strength FROM medicines WHERE id = $1`,
        [medicineId]
      );
      if (rows.length) {
        const d = String(rows[0].display_name || "").trim();
        const st = String(rows[0].strength || "").trim();
        const hasStrength = st && d.toLowerCase().includes(st.toLowerCase());
        queryText = hasStrength ? d : `${d} ${st}`.trim();
      }
    } catch {
      // If DB is down, still allow best-effort online compare using q= (if provided).
      queryText = qParam;
    }
  }

  if (!queryText || queryText.length > 200) {
    return res.status(400).json({ error: "Provide q= or medicineId=" });
  }

  const { results, elapsed_ms } = await quoteAllProvidersParallel(queryText);

  const priced = results
    .filter(
      (r) =>
        r.ok &&
        r.price_inr != null &&
        (r.data_mode === "partner_api" ||
          r.data_mode === "illustrative_fallback" ||
          r.data_mode === "medplus_catalog" ||
          r.data_mode === "apollo_catalog" ||
          r.data_mode === "netmeds_catalog")
    )
    .map((r) => Number(r.price_inr));
  const min = priced.length ? Math.min(...priced) : null;
  const max = priced.length ? Math.max(...priced) : null;
  let spread_percent = null;
  if (min != null && max != null && max > 0 && min < max) {
    spread_percent = Math.round(((max - min) / max) * 1000) / 10;
  }

  res.json({
    query: queryText,
    medicineId: medicineId != null && Number.isFinite(medicineId) ? medicineId : null,
    parallel_ms: elapsed_ms,
    stats: { min_inr: min, max_inr: max, spread_percent },
    providers: results,
    disclaimer:
      "Online retailer prices are best-effort. Some providers may block server-side requests or be temporarily unavailable. We return partial results per provider with error details when a provider fails.",
  });
});

export default router;
