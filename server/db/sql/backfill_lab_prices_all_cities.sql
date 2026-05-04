-- Idempotent: for each lab test, pick one reference price row (prefers Bengaluru, else
-- lowest city id) and INSERT the same price for every city that lacks that
-- (city_id, lab_name, test_id) combination.
--
-- Run via: npm run db:backfill-lab-prices
-- (Automatically run after npm run db:load-full-data.)

INSERT INTO lab_test_prices (city_id, lab_name, test_id, price_inr, mrp_inr)
SELECT c.id, r.lab_name, r.test_id, r.price_inr, r.mrp_inr
FROM cities c
CROSS JOIN (
  SELECT DISTINCT ON (p.test_id)
    p.lab_name,
    p.test_id,
    p.price_inr,
    p.mrp_inr
  FROM lab_test_prices p
  INNER JOIN cities ct ON ct.id = p.city_id
  ORDER BY
    p.test_id,
    (ct.slug IN ('bengaluru', 'bangalore'))::int DESC,
    ct.id ASC
) r
WHERE NOT EXISTS (
  SELECT 1
  FROM lab_test_prices x
  WHERE x.city_id = c.id
    AND x.test_id = r.test_id
    AND x.lab_name = r.lab_name
)
ON CONFLICT (city_id, lab_name, test_id) DO NOTHING;
