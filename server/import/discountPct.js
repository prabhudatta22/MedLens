/**
 * Parse discount % from import row (0–100). Accepts 10, 10%, 10.5, etc.
 */
export function parseOptionalDiscountPct(row) {
  const raw = pickFirst(row, [
    "discount_pct",
    "discount_percent",
    "discount_percentage",
    "discount",
    "disc_pct",
    "disc",
    "off_pct",
    "off_percent",
  ]);
  if (raw == null || String(raw).trim() === "") return null;
  const s = String(raw).replace(/%/g, "").replace(/,/g, "").trim();
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    throw new Error(`Invalid discount %: ${raw} (use 0–100)`);
  }
  return Math.round(n * 1000) / 1000;
}

function pickFirst(row, keys) {
  for (const k of keys) {
    if (row[k] != null && String(row[k]).trim() !== "") return row[k];
  }
  return null;
}

/**
 * If discount not given, derive from MRP and selling price (retail).
 */
export function deriveDiscountPct(priceInr, mrpInr) {
  if (mrpInr == null || !Number.isFinite(Number(mrpInr)) || Number(mrpInr) <= 0) return null;
  if (!Number.isFinite(Number(priceInr)) || Number(priceInr) < 0) return null;
  const p = Number(priceInr);
  const m = Number(mrpInr);
  if (p > m) return null;
  return Math.round((1 - p / m) * 100000) / 1000;
}

/**
 * Compute selling price from MRP and discount %.
 */
export function priceFromMrpAndDiscount(mrpInr, discountPct) {
  if (mrpInr == null || !Number.isFinite(Number(mrpInr)) || Number(mrpInr) < 0) return null;
  if (discountPct == null || !Number.isFinite(Number(discountPct))) return null;
  const m = Number(mrpInr);
  const d = Number(discountPct);
  const x = m * (1 - d / 100);
  return Math.round(x * 100) / 100;
}
