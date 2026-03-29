import { Router } from "express";
import multer from "multer";
import { pool } from "../db/pool.js";
import { parsePricesXlsx } from "../import/excelPrices.js";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
});

function slugifyCity(name) {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

router.post("/prices/xlsx", upload.single("file"), async (req, res) => {
  if (!req.file?.buffer) {
    return res.status(400).json({ error: "Missing file (field name: file)" });
  }

  let parsed;
  try {
    parsed = parsePricesXlsx(req.file.buffer);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  const client = await pool.connect();
  const summary = {
    sheet: parsed.sheetName,
    rows: parsed.rows.length,
    inserted: { cities: 0, pharmacies: 0, medicines: 0, prices: 0 },
    updated: { prices: 0 },
    errors: [],
  };

  try {
    await client.query("BEGIN");

    for (const r of parsed.rows) {
      try {
        const citySlug = slugifyCity(r.city);
        const cityRes = await client.query(
          `INSERT INTO cities (name, state, slug)
           VALUES ($1, $2, $3)
           ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, state = EXCLUDED.state
           RETURNING id`,
          [r.city, r.state, citySlug]
        );
        const cityId = cityRes.rows[0].id;

        // Find-or-create pharmacy (name + city). If lat/lng missing, default to 0,0 (caller should provide for map).
        const lat = r.pharmacy.lat ?? 0;
        const lng = r.pharmacy.lng ?? 0;

        const existingPharm = await client.query(
          `SELECT id FROM pharmacies WHERE city_id = $1 AND lower(name) = lower($2) LIMIT 1`,
          [cityId, r.pharmacy.name]
        );
        let pharmacyId;
        if (existingPharm.rows.length) {
          pharmacyId = existingPharm.rows[0].id;
          await client.query(
            `UPDATE pharmacies
             SET chain = COALESCE($1, chain),
                 address_line = COALESCE($2, address_line),
                 pincode = COALESCE($3, pincode),
                 lat = CASE WHEN $4::double precision = 0 AND lat <> 0 THEN lat ELSE $4 END,
                 lng = CASE WHEN $5::double precision = 0 AND lng <> 0 THEN lng ELSE $5 END
             WHERE id = $6`,
            [
              r.pharmacy.chain,
              r.pharmacy.address_line,
              r.pharmacy.pincode,
              lat,
              lng,
              pharmacyId,
            ]
          );
        } else {
          const insPharm = await client.query(
            `INSERT INTO pharmacies (name, chain, city_id, address_line, pincode, lat, lng)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id`,
            [
              r.pharmacy.name,
              r.pharmacy.chain,
              cityId,
              r.pharmacy.address_line,
              r.pharmacy.pincode,
              lat,
              lng,
            ]
          );
          pharmacyId = insPharm.rows[0].id;
          summary.inserted.pharmacies += 1;
        }

        // Find-or-create medicine (display_name + strength + form + pack_size)
        const existingMed = await client.query(
          `SELECT id FROM medicines
           WHERE lower(display_name) = lower($1)
             AND lower(strength) = lower($2)
             AND lower(form) = lower($3)
             AND pack_size = $4
           LIMIT 1`,
          [r.medicine.display_name, r.medicine.strength, r.medicine.form, r.medicine.pack_size]
        );
        let medicineId;
        if (existingMed.rows.length) {
          medicineId = existingMed.rows[0].id;
          await client.query(
            `UPDATE medicines
             SET generic_name = COALESCE($1, generic_name)
             WHERE id = $2`,
            [r.medicine.generic_name, medicineId]
          );
        } else {
          const insMed = await client.query(
            `INSERT INTO medicines (display_name, generic_name, strength, form, pack_size)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id`,
            [
              r.medicine.display_name,
              r.medicine.generic_name,
              r.medicine.strength,
              r.medicine.form,
              r.medicine.pack_size,
            ]
          );
          medicineId = insMed.rows[0].id;
          summary.inserted.medicines += 1;
        }

        // Upsert price (unique on pharmacy_id, medicine_id, price_type)
        const up = await client.query(
          `INSERT INTO pharmacy_prices (pharmacy_id, medicine_id, price_inr, mrp_inr, in_stock, price_type)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (pharmacy_id, medicine_id, price_type)
           DO UPDATE SET price_inr = EXCLUDED.price_inr,
                         mrp_inr = EXCLUDED.mrp_inr,
                         in_stock = EXCLUDED.in_stock,
                         updated_at = now()
           RETURNING (xmax = 0) AS inserted`,
          [
            pharmacyId,
            medicineId,
            r.price.price_inr,
            r.price.mrp_inr,
            r.price.in_stock,
            r.price.price_type,
          ]
        );
        if (up.rows[0].inserted) summary.inserted.prices += 1;
        else summary.updated.prices += 1;
      } catch (e) {
        summary.errors.push({ row: r.rowNum, error: e.message });
      }
    }

    await client.query("COMMIT");
    return res.json({ ok: true, summary });
  } catch (e) {
    await client.query("ROLLBACK");
    return res.status(500).json({ ok: false, error: e.message, summary });
  } finally {
    client.release();
  }
});

export default router;

