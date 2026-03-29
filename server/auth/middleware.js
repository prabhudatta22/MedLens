import { pool } from "../db/pool.js";

export async function attachUser(req, _res, next) {
  const sid = req.cookies?.sid;
  if (!sid) return next();

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

