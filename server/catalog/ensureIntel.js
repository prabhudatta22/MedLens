import { normalizeMedicinePhrase } from "./normalizePhrase.js";

let intelPromise;

/**
 * One-time-per-process backfill of `drug_concepts`, link `medicines.drug_concept_id`,
 * and seed coarse aliases so search can resolve concepts.
 */
export function ensureCatalogIntelligence(pool) {
  if (!intelPromise) {
    intelPromise = runIntel(pool).catch((err) => {
      // Do not permanently poison compare routes after a transient first-run DB failure.
      intelPromise = undefined;
      throw err;
    });
  }
  return intelPromise;
}

export function resetCatalogIntelligenceForTests() {
  intelPromise = undefined;
}

async function runIntel(pool) {
  await pool.query(`
    INSERT INTO drug_concepts (key_hash, canonical_label, generic_key, strength, form)
    SELECT key_hash,
           canonical_label,
           generic_key,
           strength,
           form
    FROM (
      SELECT
        encode(
          digest(
            lower(trim(coalesce(nullif(trim(m.generic_name), ''), trim(m.display_name)))) || '|' ||
            lower(trim(m.strength)) || '|' ||
            lower(trim(m.form)),
            'sha256'
          ),
          'hex'
        ) AS key_hash,
        trim(m.display_name) AS canonical_label,
        trim(coalesce(nullif(trim(m.generic_name), ''), trim(m.display_name))) AS generic_key,
        trim(m.strength) AS strength,
        trim(m.form) AS form,
        ROW_NUMBER() OVER (
          PARTITION BY encode(
            digest(
              lower(trim(coalesce(nullif(trim(m.generic_name), ''), trim(m.display_name)))) || '|' ||
              lower(trim(m.strength)) || '|' ||
              lower(trim(m.form)),
              'sha256'
            ),
            'hex'
          )
          ORDER BY m.id
        ) AS rn
      FROM medicines m
    ) ranked
    WHERE rn = 1
    ON CONFLICT (key_hash) DO NOTHING
  `);

  await pool.query(`
    UPDATE medicines m
    SET drug_concept_id = dc.id
    FROM drug_concepts dc
    WHERE dc.key_hash = encode(
      digest(
        lower(trim(coalesce(nullif(trim(m.generic_name), ''), trim(m.display_name)))) || '|' ||
        lower(trim(m.strength)) || '|' ||
        lower(trim(m.form)),
        'sha256'
      ),
      'hex'
    )
  `);

  await pool.query(`
    INSERT INTO medicine_aliases (alias_normalized, drug_concept_id, source)
    SELECT DISTINCT
      regexp_replace(trim(lower(trim(m.display_name))), '\\s+', ' ', 'g'),
      m.drug_concept_id,
      'auto_display'
    FROM medicines m
    WHERE m.drug_concept_id IS NOT NULL AND length(trim(m.display_name)) > 2
    ON CONFLICT (alias_normalized, drug_concept_id) DO NOTHING
  `);

  await pool.query(`
    INSERT INTO medicine_aliases (alias_normalized, drug_concept_id, source)
    SELECT DISTINCT
      regexp_replace(trim(lower(trim(coalesce(nullif(trim(m.generic_name), ''), '')))), '\\s+', ' ', 'g'),
      m.drug_concept_id,
      'auto_generic'
    FROM medicines m
    WHERE m.drug_concept_id IS NOT NULL
      AND nullif(trim(m.generic_name), '') IS NOT NULL
      AND length(trim(m.generic_name)) > 2
    ON CONFLICT (alias_normalized, drug_concept_id) DO NOTHING
  `);
}
