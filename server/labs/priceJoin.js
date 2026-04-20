/**
 * Local diagnostics catalog: one price row per lab test, preferring the user's
 * city when present, then Bengaluru (demo reference), then cheapest available.
 * @param {string} citySlugParam e.g. "$2" for main API routes, "$1" in helpers
 */
export function labPriceLateralSql(citySlugParam) {
  return `
  CROSS JOIN LATERAL (
    SELECT p.lab_name, p.price_inr, p.mrp_inr, p.discount_pct
    FROM lab_test_prices p
    INNER JOIN cities cref ON cref.id = p.city_id
    WHERE p.test_id = t.id
    ORDER BY (cref.slug = ${citySlugParam})::int DESC,
             (cref.slug IN ('bengaluru', 'bangalore'))::int DESC,
             p.price_inr ASC NULLS LAST
    LIMIT 1
  ) p`;
}
