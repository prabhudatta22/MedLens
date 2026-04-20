import { pool } from "../db/pool.js";
import { labPriceLateralSql } from "./priceJoin.js";

function normalizeLine(line) {
  return line
    .toLowerCase()
    .replace(/[^\w\s.+-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function splitCandidateLines(ocrText) {
  return String(ocrText)
    .split(/\r?\n/g)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 200);
}

/**
 * Match OCR lines to known lab tests/packages using pg_trgm similarity on lab_tests.search_vector.
 * Returns best matches (deduped by test_id).
 */
export async function matchLabTestsFromText(ocrText, { limitItems = 8, citySlug } = {}) {
  if (!citySlug) throw new Error("citySlug is required");
  const lines = splitCandidateLines(ocrText);
  const scored = [];

  for (const rawLine of lines) {
    const line = normalizeLine(rawLine);
    if (line.length < 3) continue;

    const { rows } = await pool.query(
      `SELECT
         t.id AS test_id,
         t.heading,
         t.sub_heading,
         t.category,
         t.slug,
         similarity(t.search_vector, $1) AS score
       FROM lab_tests t
       WHERE t.search_vector % $1
       ORDER BY score DESC
       LIMIT 3`,
      [line]
    );

    for (const r of rows) {
      const score = Number(r.score);
      if (Number.isNaN(score) || score < 0.25) continue;
      scored.push({
        test_id: r.test_id,
        heading: r.heading,
        sub_heading: r.sub_heading,
        category: r.category,
        slug: r.slug,
        score,
        match_line: rawLine,
      });
    }
  }

  // keep best per test_id
  const best = new Map();
  for (const s of scored) {
    const prev = best.get(s.test_id);
    if (!prev || s.score > prev.score) best.set(s.test_id, s);
  }

  const deduped = Array.from(best.values()).sort((a, b) => b.score - a.score).slice(0, limitItems);
  if (!deduped.length) return [];

  // Attach city-specific prices for the matched tests
  const ids = deduped.map((d) => Number(d.test_id)).filter((n) => Number.isFinite(n) && n > 0);
  const { rows: priced } = await pool.query(
    `SELECT
       t.id AS test_id,
       p.lab_name,
       p.price_inr,
       p.mrp_inr,
       p.discount_pct
     FROM lab_tests t
     JOIN cities c ON c.slug = $1
     ${labPriceLateralSql("$1")}
     WHERE t.id = ANY($2::int[])`,
    [citySlug, ids]
  );
  const priceById = new Map(priced.map((r) => [Number(r.test_id), r]));

  return deduped.map((d) => ({ ...d, ...(priceById.get(Number(d.test_id)) || {}) }));
}

