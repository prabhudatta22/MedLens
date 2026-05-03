/**
 * Shared SELECT list for local DB pharmacy compare rows.
 */
export const COMPARE_OFFER_SQL = `
  SELECT
    pp.id AS price_id,
    pp.price_inr,
    pp.mrp_inr,
    pp.discount_pct,
    pp.in_stock,
    pp.stock_status,
    pp.stock_qty,
    pp.stock_observed_at,
    pp.price_type,
    pp.updated_at,
    p.id AS pharmacy_id,
    p.name AS pharmacy_name,
    p.chain,
    p.address_line,
    p.pincode,
    p.lat,
    p.lng,
    p.listing_tier,
    p.featured_until,
    p.premium_rank_weight,
    c.name AS city_name,
    c.state,
    m.id AS medicine_id,
    m.drug_concept_id,
    m.display_name,
    m.strength,
    m.form,
    m.pack_size
`;
