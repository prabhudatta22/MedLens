import { Router } from "express";
import { pool } from "../db/pool.js";
import { requirePartner } from "../partner/auth.js";

const router = Router();

router.use(requirePartner);

router.get("/me", async (req, res) => {
  res.json({ partner: req.partner });
});

router.get("/sales/summary", async (req, res) => {
  const pharmacyId = req.partner.pharmacy_id;
  const from = req.query.from ? new Date(String(req.query.from)) : null;
  const to = req.query.to ? new Date(String(req.query.to)) : null;

  const fromOk = from && !Number.isNaN(from.getTime());
  const toOk = to && !Number.isNaN(to.getTime());

  const params = [pharmacyId];
  let where = "s.pharmacy_id = $1";
  if (fromOk) {
    params.push(from.toISOString());
    where += ` AND s.sold_at >= $${params.length}`;
  }
  if (toOk) {
    params.push(to.toISOString());
    where += ` AND s.sold_at < $${params.length}`;
  }

  const kpiRes = await pool.query(
    `SELECT
       COUNT(DISTINCT s.id)::int AS orders,
       COALESCE(SUM(si.quantity * si.unit_sell_inr), 0)::numeric(12,2) AS revenue_inr,
       COALESCE(SUM(si.quantity * si.unit_cost_inr), 0)::numeric(12,2) AS cost_inr,
       COALESCE(SUM(si.quantity * (si.unit_sell_inr - si.unit_cost_inr)), 0)::numeric(12,2) AS profit_inr
     FROM sales s
     JOIN sale_items si ON si.sale_id = s.id
     WHERE ${where}`,
    params
  );

  const topRes = await pool.query(
    `SELECT
       m.id AS medicine_id,
       m.display_name,
       SUM(si.quantity)::int AS units,
       SUM(si.quantity * si.unit_sell_inr)::numeric(12,2) AS revenue_inr,
       SUM(si.quantity * (si.unit_sell_inr - si.unit_cost_inr))::numeric(12,2) AS profit_inr
     FROM sales s
     JOIN sale_items si ON si.sale_id = s.id
     JOIN medicines m ON m.id = si.medicine_id
     WHERE ${where}
     GROUP BY m.id, m.display_name
     ORDER BY revenue_inr DESC
     LIMIT 10`,
    params
  );

  const dailyRes = await pool.query(
    `SELECT
       date_trunc('day', s.sold_at) AS day,
       COUNT(DISTINCT s.id)::int AS orders,
       SUM(si.quantity * si.unit_sell_inr)::numeric(12,2) AS revenue_inr,
       SUM(si.quantity * (si.unit_sell_inr - si.unit_cost_inr))::numeric(12,2) AS profit_inr
     FROM sales s
     JOIN sale_items si ON si.sale_id = s.id
     WHERE ${where}
     GROUP BY day
     ORDER BY day ASC
     LIMIT 90`,
    params
  );

  const kpi = kpiRes.rows[0] || {
    orders: 0,
    revenue_inr: "0.00",
    cost_inr: "0.00",
    profit_inr: "0.00",
  };
  const revenue = Number(kpi.revenue_inr);
  const profit = Number(kpi.profit_inr);
  const margin = revenue > 0 ? profit / revenue : null;

  res.json({
    pharmacyId,
    range: { from: fromOk ? from.toISOString() : null, to: toOk ? to.toISOString() : null },
    kpi: { ...kpi, margin },
    top_medicines: topRes.rows,
    daily: dailyRes.rows.map((r) => ({
      day: r.day,
      orders: r.orders,
      revenue_inr: r.revenue_inr,
      profit_inr: r.profit_inr,
    })),
  });
});

router.get("/sales/recent", async (req, res) => {
  const pharmacyId = req.partner.pharmacy_id;
  const { rows } = await pool.query(
    `SELECT
       s.id,
       s.sold_at,
       s.channel,
       COALESCE(SUM(si.quantity * si.unit_sell_inr), 0)::numeric(12,2) AS revenue_inr,
       COALESCE(SUM(si.quantity * (si.unit_sell_inr - si.unit_cost_inr)), 0)::numeric(12,2) AS profit_inr
     FROM sales s
     LEFT JOIN sale_items si ON si.sale_id = s.id
     WHERE s.pharmacy_id = $1
     GROUP BY s.id
     ORDER BY s.sold_at DESC
     LIMIT 20`,
    [pharmacyId]
  );
  res.json({ sales: rows });
});

export default router;

