function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

function readPositiveInteger(value, fallback = 1) {
  const raw = value == null || value === "" ? fallback : value;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw badRequest("Invalid quantity in items[]");
  const qty = Math.floor(n);
  if (qty < 1 || qty > 999) throw badRequest("Invalid quantity in items[]");
  return qty;
}

function readOptionalPositiveNumber(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function normalizeMedicineOrderInputItem(raw) {
  const pharmacyId = Number(raw?.pharmacyId);
  const medicineId = Number(raw?.medicineId);
  if (!Number.isFinite(pharmacyId) || pharmacyId < 1) throw badRequest("Invalid pharmacyId in items[]");
  if (!Number.isFinite(medicineId) || medicineId < 1) throw badRequest("Invalid medicineId in items[]");
  return {
    pharmacy_id: Math.floor(pharmacyId),
    medicine_id: Math.floor(medicineId),
    quantity_units: readPositiveInteger(raw?.quantity ?? raw?.quantity_units ?? 1),
    tablets_per_day: readOptionalPositiveNumber(raw?.tablets_per_day),
  };
}

export function totalMedicineOrderItemsPaise(items) {
  return (items || []).reduce((sum, it) => {
    const unitPaise = Math.round(Number(it.unit_price_inr) * 100);
    return sum + unitPaise * Number(it.quantity_units);
  }, 0);
}

/**
 * Loads authoritative retail prices from the DB for medicine delivery order items.
 * Client cart prices are display hints only; payments and persisted order rows must
 * use current pharmacy_prices data.
 */
export async function loadAuthoritativeMedicineOrderItems(db, rawItems) {
  const inputs = (rawItems || []).map(normalizeMedicineOrderInputItem);
  const out = [];
  for (const item of inputs) {
    const { rows } = await db.query(
      `SELECT
         pp.price_inr,
         pp.mrp_inr,
         pp.in_stock,
         m.display_name,
         m.strength,
         m.form,
         m.pack_size
       FROM pharmacy_prices pp
       JOIN medicines m ON m.id = pp.medicine_id
       WHERE pp.pharmacy_id = $1
         AND pp.medicine_id = $2
         AND pp.price_type = 'retail'
       LIMIT 1`,
      [item.pharmacy_id, item.medicine_id]
    );
    if (!rows.length) {
      throw badRequest("Selected medicine is no longer available from this pharmacy");
    }
    const row = rows[0];
    const unit = Number(row.price_inr);
    if (!Number.isFinite(unit) || unit < 0) {
      throw badRequest("Selected medicine has invalid pharmacy pricing");
    }
    out.push({
      ...item,
      item_label: String(row.display_name || "Medicine").trim().slice(0, 200),
      strength: row.strength ? String(row.strength).trim().slice(0, 80) : null,
      form: row.form ? String(row.form).trim().slice(0, 40) : null,
      pack_size: row.pack_size != null ? Number(row.pack_size) : null,
      unit_price_inr: unit,
      mrp_inr: row.mrp_inr == null ? null : Number(row.mrp_inr),
    });
  }
  return out;
}
