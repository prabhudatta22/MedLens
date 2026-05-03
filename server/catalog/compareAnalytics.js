function truthyAnalytics() {
  return String(process.env.CATALOG_ANALYTICS || "").trim() === "1";
}

export function isCatalogAnalyticsEnabled() {
  return truthyAnalytics();
}

function consumerUserPk(req) {
  const id = req?.user?.id;
  return typeof id === "number" && Number.isFinite(id) ? id : null;
}

/**
 * One row per offer position for demand analytics (partner dashboards).
 */
export async function logCatalogCompareImpressions(
  pool,
  { req, source, query, citySlug, pincode, offers, extraMeta = null }
) {
  if (!truthyAnalytics() || !offers?.length) return;

  const user_id = consumerUserPk(req);
  const baseExtra =
    extraMeta && typeof extraMeta === "object" && !Array.isArray(extraMeta) ? extraMeta : null;

  let paramIndex = 1;
  const parts = [];
  const params = [];
  for (let i = 0; i < offers.length; i += 1) {
    const o = offers[i];
    const pharmacyId = Number(o.pharmacy_id);
    if (!Number.isFinite(pharmacyId) || pharmacyId < 1) continue;

    params.push(user_id ?? null); // nullable
    const u = paramIndex++;
    params.push(pharmacyId); // pharmacy_id - must be INTEGER to match FK
    const ph = paramIndex++;
    const mid = o.medicine_id != null ? Number(o.medicine_id) : null;
    params.push(Number.isFinite(mid) && mid > 0 ? mid : null);
    const mi = paramIndex++;
    const dcid = o.drug_concept_id != null ? Number(o.drug_concept_id) : null;
    params.push(Number.isFinite(dcid) && dcid > 0 ? dcid : null);
    const dc = paramIndex++;
    params.push(citySlug || null);
    const cs = paramIndex++;
    params.push(query || null);
    const qq = paramIndex++;
    const meta = {
      source,
      rank: i + 1,
      pincode: pincode || null,
      price_inr: o.price_inr != null ? Number(o.price_inr) : null,
      price_per_unit_inr: o.price_per_unit_inr != null ? Number(o.price_per_unit_inr) : null,
      stock_status: o.stock_status ?? null,
      sponsored_listing: Boolean(o.sponsored_listing),
      ...(baseExtra || {}),
    };
    params.push(JSON.stringify(meta));
    const mj = paramIndex++;

    parts.push(
      `(now(), $${u}, $${ph}, $${mi}, $${dc}, $${cs}, $${qq}, 'catalog_compare_impression', $${mj}::jsonb)`
    );
  }

  if (!parts.length) return;

  const sql = `
    INSERT INTO analytics_events (created_at, user_id, pharmacy_id, medicine_id, drug_concept_id, city_slug, query, event_type, meta)
    VALUES ${parts.join(",\n")}
  `;
  await pool.query(sql, params);
}
