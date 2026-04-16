/**
 * ABHA / Health ID identifier validation (format only).
 * Live ABDM verification is performed server-side after sandbox credentials are configured.
 */

export function normalizeAbhaIdentifier(raw) {
  const s = String(raw || "").trim();
  if (!s) throw new Error("ABHA / Health ID is required");
  if (s.includes("@")) {
    const lower = s.toLowerCase();
    if (lower.length < 5 || lower.length > 100) throw new Error("Invalid PHR address length");
    if (!/^[\w.-]+@[\w.-]+$/.test(lower)) throw new Error("Invalid PHR address format");
    return { kind: "phr", value: lower };
  }
  const digits = s.replace(/\D/g, "");
  if (digits.length !== 14) throw new Error("ABHA number must be 14 digits (spaces or hyphens allowed)");
  return { kind: "number", value: digits };
}

export function maskHealthIdNumber(digits14) {
  const d = String(digits14 || "").replace(/\D/g, "");
  if (d.length !== 14) return "—";
  return `${d.slice(0, 2)}-****-****-${d.slice(-4)}`;
}
