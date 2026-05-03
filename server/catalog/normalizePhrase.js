/**
 * Normalize medicine search phrases for aliases and drug-concept lookups.
 */
export function normalizeMedicinePhrase(q) {
  return (q ?? "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .slice(0, 220);
}
