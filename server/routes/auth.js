import { Router } from "express";
import { pool } from "../db/pool.js";
import {
  generateOtpCode,
  hashOtp,
  normalizeIndiaPhoneToE164,
  randomSessionId,
} from "../auth/phone.js";

const router = Router();

function otpPepper() {
  return process.env.OTP_PEPPER || "dev-only-pepper-change-me";
}

router.post("/request-otp", async (req, res) => {
  const phoneE164 = normalizeIndiaPhoneToE164(req.body?.phone);
  if (!phoneE164) return res.status(400).json({ error: "Invalid phone number (India only)" });

  // Basic rate limit: max 5 per 10 minutes per phone
  const { rows: recent } = await pool.query(
    `SELECT COUNT(*)::int AS c
     FROM otp_codes
     WHERE phone_e164 = $1 AND created_at > now() - interval '10 minutes'`,
    [phoneE164]
  );
  if (recent[0]?.c >= 5) return res.status(429).json({ error: "Too many OTP requests. Try later." });

  const code = generateOtpCode();
  const codeHash = hashOtp({ phoneE164, code, pepper: otpPepper() });
  const expiresMinutes = Number(process.env.OTP_EXPIRES_MINUTES || 5);
  const expiresAt = new Date(Date.now() + expiresMinutes * 60_000).toISOString();

  await pool.query(
    `INSERT INTO otp_codes (phone_e164, code_hash, expires_at, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5)`,
    [phoneE164, codeHash, expiresAt, req.ip, req.header("user-agent") || null]
  );

  // Delivery: for now (MVP) we don't integrate SMS provider.
  // In production, send via SMS/WhatsApp and NEVER return the OTP.
  const isProd = process.env.NODE_ENV === "production";

  res.json({
    ok: true,
    phone: phoneE164,
    expires_minutes: expiresMinutes,
    dev_otp: isProd ? undefined : code,
    delivery: isProd ? "sms_pending" : "dev_returned",
  });
});

router.post("/verify-otp", async (req, res) => {
  const phoneE164 = normalizeIndiaPhoneToE164(req.body?.phone);
  const code = String(req.body?.code || "").trim();
  if (!phoneE164) return res.status(400).json({ error: "Invalid phone number (India only)" });
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: "Invalid OTP" });

  const codeHash = hashOtp({ phoneE164, code, pepper: otpPepper() });

  const { rows } = await pool.query(
    `SELECT id, expires_at, consumed_at
     FROM otp_codes
     WHERE phone_e164 = $1 AND code_hash = $2 AND purpose = 'login'
     ORDER BY created_at DESC
     LIMIT 1`,
    [phoneE164, codeHash]
  );
  if (!rows.length) return res.status(401).json({ error: "Incorrect OTP" });

  const otp = rows[0];
  if (otp.consumed_at) return res.status(401).json({ error: "OTP already used" });
  if (new Date(otp.expires_at).getTime() < Date.now()) return res.status(401).json({ error: "OTP expired" });

  await pool.query(`UPDATE otp_codes SET consumed_at = now() WHERE id = $1`, [otp.id]);

  const userRes = await pool.query(
    `INSERT INTO users (phone_e164, last_login_at)
     VALUES ($1, now())
     ON CONFLICT (phone_e164) DO UPDATE SET last_login_at = now()
     RETURNING id, phone_e164`,
    [phoneE164]
  );
  const user = userRes.rows[0];

  const sid = randomSessionId();
  const days = Number(process.env.SESSION_DAYS || 30);
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60_000).toISOString();
  await pool.query(
    `INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)`,
    [sid, user.id, expiresAt]
  );

  res.cookie("sid", sid, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: new Date(expiresAt),
  });

  res.json({ ok: true, user: { id: user.id, phone_e164: user.phone_e164 } });
});

router.post("/login", async (req, res) => {
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "").trim();

  const isProd = process.env.NODE_ENV === "production";
  // Allow only when explicitly enabled (even in production).
  const allowDevLogin = String(process.env.ENABLE_DEV_ADMIN_LOGIN || "false") === "true";
  if (!allowDevLogin) return res.status(404).json({ error: "Not found" });

  const expectedUser = String(process.env.DEV_ADMIN_USERNAME || "admin").trim();
  const expectedPass = String(process.env.DEV_ADMIN_PASSWORD || "admin").trim();

  // Dev-only convenience: treat admin creds case-insensitively to avoid UX friction.
  const uOk = username.toLowerCase() === expectedUser.toLowerCase();
  const pOk = password.toLowerCase() === expectedPass.toLowerCase();
  if (!uOk || !pOk) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const days = Number(process.env.SESSION_DAYS || 30);
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60_000).toISOString();

  // Prefer DB-backed sessions when DB is available.
  // If DB is down/misconfigured, fall back to a dev-only cookie that middleware recognizes.
  try {
    const phoneE164 = "+910000000000";
    const userRes = await pool.query(
      `INSERT INTO users (phone_e164, last_login_at)
       VALUES ($1, now())
       ON CONFLICT (phone_e164) DO UPDATE SET last_login_at = now()
       RETURNING id, phone_e164`,
      [phoneE164]
    );
    const user = userRes.rows[0];

    const sid = randomSessionId();
    await pool.query(`INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)`, [
      sid,
      user.id,
      expiresAt,
    ]);

    res.cookie("sid", sid, {
      httpOnly: true,
      sameSite: "lax",
      secure: isProd,
      expires: new Date(expiresAt),
    });

    return res.json({ ok: true, user: { id: user.id, phone_e164: user.phone_e164, dev_admin: true } });
  } catch (e) {
    const sid = "dev-admin";
    res.cookie("sid", sid, {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      expires: new Date(expiresAt),
    });

    return res.json({
      ok: true,
      user: { id: 0, phone_e164: "+910000000000", dev_admin: true },
      warning: "Database unavailable; using dev-only login cookie.",
      detail: String(e?.message || e),
    });
  }

  // unreachable
});

router.post("/logout", async (req, res) => {
  const sid = req.cookies?.sid;
  if (sid) {
    await pool.query(`UPDATE sessions SET revoked_at = now() WHERE id = $1`, [sid]);
  }
  res.clearCookie("sid");
  res.json({ ok: true });
});

router.get("/me", async (req, res) => {
  res.json({ user: req.user || null });
});

export default router;

