import { pool } from "../db/pool.js";

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
 * Match OCR lines to known medicines using pg_trgm similarity on medicines.search_vector.
 * Returns best matches (deduped by medicine_id).
 */
export async function matchMedicinesFromText(ocrText, { limitItems = 8 } = {}) {
  const lines = splitCandidateLines(ocrText);
  const scored = [];

  for (const rawLine of lines) {
    const line = normalizeLine(rawLine);
    if (line.length < 4) continue;

    const { rows } = await pool.query(
      `SELECT
         id AS medicine_id,
         display_name,
         strength,
         form,
         pack_size,
         similarity(search_vector, $1) AS score
       FROM medicines
       WHERE search_vector % $1
       ORDER BY score DESC
       LIMIT 3`,
      [line]
    );

    for (const r of rows) {
      const score = Number(r.score);
      if (Number.isNaN(score) || score < 0.25) continue;
      scored.push({
        medicine_id: r.medicine_id,
        display_name: r.display_name,
        strength: r.strength,
        form: r.form,
        pack_size: r.pack_size,
        score,
        match_line: rawLine,
      });
    }
  }

  // keep best per medicine_id
  const best = new Map();
  for (const s of scored) {
    const prev = best.get(s.medicine_id);
    if (!prev || s.score > prev.score) best.set(s.medicine_id, s);
  }

  return Array.from(best.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limitItems);
}

