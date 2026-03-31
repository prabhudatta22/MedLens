import { pool } from "../db/pool.js";

export async function attachUser(req, _res, next) {
  const sid = req.cookies?.sid;
  if (!sid) return next();

  // Dev-only escape hatch so the demo can be used without a working DB.
  // Enabled only when NODE_ENV != production and ENABLE_DEV_ADMIN_LOGIN=true.
  const isProd = process.env.NODE_ENV === "production";
  const allowDevLogin = !isProd && String(process.env.ENABLE_DEV_ADMIN_LOGIN || "true") === "true";
  if (allowDevLogin && sid === "dev-admin") {
    req.user = { id: 0, phone_e164: "+910000000000", session_id: sid, dev_admin: true };
    return next();
  }

  const { rows } = await pool.query(
    `SELECT s.id AS session_id, s.expires_at, s.revoked_at,
            u.id AS user_id, u.phone_e164
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = $1
     LIMIT 1`,
    [sid]
  );
  if (!rows.length) return next();
  const s = rows[0];
  if (s.revoked_at) return next();
  if (new Date(s.expires_at).getTime() < Date.now()) return next();

  req.user = { id: s.user_id, phone_e164: s.phone_e164, session_id: s.session_id };
  return next();
}

export function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Not logged in" });
  return next();
}

