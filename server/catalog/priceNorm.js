/**
 * Pack-price → per‑unit INR for compare/ranking (`pack_size` = units per pack).
 */
export function pricePerPackUnitInr(priceInr, packSize) {
  const p = Number(priceInr);
  const pk = Number(packSize);
  if (!Number.isFinite(p) || p <= 0) return null;
  if (!Number.isFinite(pk) || pk <= 0) return Math.round(p * 10000) / 10000;
  const v = p / pk;
  return Math.round(v * 10000) / 10000;
}

/**
 * Attach `price_per_unit_inr` to each offer row (non-mutating where possible via spread).
 */
export function enrichOffersWithUnitPricing(rows) {
  return rows.map((r) => {
    const price_per_unit_inr = pricePerPackUnitInr(r.price_inr, r.pack_size);
    return { ...r, price_per_unit_inr };
  });
}
