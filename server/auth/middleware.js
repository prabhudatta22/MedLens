import { pool } from "../db/pool.js";
import { getProviderSession } from "./providerSessions.js";

export async function attachUser(req, _res, next) {
  const sid = req.cookies?.sid;
  if (!sid) return next();

  // 1) Service Provider sessions (Redis, 5 min TTL)
  try {
    const sp = await getProviderSession(sid);
    if (sp?.kind === "service_provider") {
      req.user = {
        id: `sp:${sp.provider_user_id}`,
        username: sp.username,
        role: "service_provider",
        session_id: sid,
      };
      return next();
    }
  } catch {
    // ignore redis errors; fall back to DB sessions
  }

  // 2) User sessions (Postgres, OTP flow)
  const { rows } = await pool.query(
    `SELECT s.id AS session_id, s.expires_at, s.revoked_at,
            u.id AS user_id,
            u.phone_e164,
            to_jsonb(u) ->> 'email' AS email,
            to_jsonb(u) ->> 'full_name' AS full_name,
            to_jsonb(u) ->> 'gender' AS gender
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

  const uidNum = Number(s.user_id);
  if (!Number.isFinite(uidNum) || uidNum < 1) return next();

  req.user = {
    id: uidNum,
    role: "user",
    phone_e164: s.phone_e164,
    email: s.email,
    full_name: s.full_name,
    gender: s.gender,
    session_id: s.session_id,
  };
  return next();
}

export function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Not logged in" });
  return next();
}

