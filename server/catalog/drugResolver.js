import { normalizeMedicinePhrase } from "./normalizePhrase.js";

function parseConceptIdRows(rows) {
  const out = [];
  const seen = new Set();
  for (const row of rows) {
    const id = Number(row.id);
    if (Number.isFinite(id) && id > 0 && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/**
 * Resolve likely `drug_concepts.id` matches for user search strings (aliases + trigram-ish match).
 */
export async function resolveDrugConceptIds(pool, rawQuery, { limitPerSource = 12 } = {}) {
  const q = normalizeMedicinePhrase(rawQuery);
  if (!q || q.length < 2) return [];

  const aliasRes = await pool.query(
    `SELECT drug_concept_id AS id
     FROM medicine_aliases
     WHERE alias_normalized = $1
     UNION
     SELECT drug_concept_id AS id
     FROM medicine_aliases
     WHERE alias_normalized LIKE $2
     LIMIT $3`,
    [q, `%${q}%`, limitPerSource * 3]
  );
  const ids = parseConceptIdRows(aliasRes.rows);
  if (ids.length >= 3) return ids.slice(0, limitPerSource);

  const like = `%${q}%`;
  const simRes = await pool.query(
    `SELECT id
     FROM drug_concepts
     WHERE cardinality(regexp_split_to_array(btrim($1::text), '\\s+')) > 0
       AND (
         search_blob ILIKE $2 OR
         canonical_label ILIKE $2 OR
         similarity(search_blob, $1::text) > 0.12
       )
     ORDER BY similarity(search_blob, $1::text) DESC NULLS LAST, canonical_label ASC
     LIMIT $3`,
    [q, like, limitPerSource]
  );

  for (const id of parseConceptIdRows(simRes.rows)) {
    if (!ids.includes(id)) ids.push(id);
    if (ids.length >= limitPerSource) break;
  }

  return ids;
}
