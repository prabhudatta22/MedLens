import crypto from "node:crypto";

export function normalizeIndiaPhoneToE164(input) {
  const raw = String(input || "").trim();
  const digits = raw.replace(/[^\d+]/g, "");

  if (digits.startsWith("+")) {
    // accept +91XXXXXXXXXX only for now
    if (!digits.startsWith("+91")) return null;
    const rest = digits.slice(3).replace(/\D/g, "");
    if (rest.length !== 10) return null;
    return `+91${rest}`;
  }

  // handle "91XXXXXXXXXX" or "0XXXXXXXXXX" or "XXXXXXXXXX"
  const only = digits.replace(/\D/g, "");
  if (only.length === 10) return `+91${only}`;
  if (only.length === 12 && only.startsWith("91")) return `+${only}`;
  if (only.length === 11 && only.startsWith("0")) return `+91${only.slice(1)}`;
  return null;
}

export function generateOtpCode() {
  // 6-digit numeric
  const n = crypto.randomInt(0, 1_000_000);
  return String(n).padStart(6, "0");
}

export function hashOtp({ phoneE164, code, pepper }) {
  // HMAC to avoid raw OTP storage
  return crypto
    .createHmac("sha256", pepper)
    .update(`${phoneE164}:${code}`)
    .digest("hex");
}

export function randomSessionId() {
  return crypto.randomBytes(32).toString("hex");
}

