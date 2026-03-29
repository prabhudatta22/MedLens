import { pool } from "../db/pool.js";

export async function requirePartner(req, res, next) {
  const apiKey = (req.header("x-api-key") || "").toString().trim();
  if (!apiKey) return res.status(401).json({ error: "Missing x-api-key" });

  const { rows } = await pool.query(
    `SELECT pp.id AS partner_id, pp.display_name, pp.pharmacy_id,
            p.name AS pharmacy_name, p.chain, p.address_line, p.pincode
     FROM partner_pharmacies pp
     JOIN pharmacies p ON p.id = pp.pharmacy_id
     WHERE pp.api_key = $1
     LIMIT 1`,
    [apiKey]
  );

  if (!rows.length) return res.status(403).json({ error: "Invalid API key" });
  req.partner = rows[0];
  return next();
}

