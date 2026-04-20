import XLSX from "xlsx";
import { deriveDiscountPct, parseOptionalDiscountPct, priceFromMrpAndDiscount } from "./discountPct.js";

function normHeader(h) {
  return String(h || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function req(row, key, rowNum) {
  const v = row[key];
  if (v === undefined || v === null || String(v).trim() === "") {
    throw new Error(`Row ${rowNum}: missing required field "${key}"`);
  }
  return v;
}

/**
 * Partner lab upload: one row per lab test price in a city.
 * Required: city, state, lab_name, test_id (matches lab_tests.id)
 * Price: price_inr OR (mrp_inr + discount_pct)
 * Optional: mrp_inr, discount_pct (0–100)
 */
export function parseLabPricesXlsx(buffer) {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("No worksheet found");
  const ws = wb.Sheets[sheetName];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
  if (!aoa.length) throw new Error("Sheet is empty");

  const headersRaw = aoa[0];
  const headers = headersRaw.map(normHeader);
  const rows = [];

  for (let i = 1; i < aoa.length; i += 1) {
    const line = aoa[i];
    if (!line || line.every((c) => c === undefined || c === null || String(c).trim() === "")) continue;
    const obj = {};
    for (let c = 0; c < headers.length; c += 1) {
      const k = headers[c];
      if (!k) continue;
      obj[k] = line[c];
    }
    rows.push({ rowNum: i + 1, row: obj });
  }

  const normalized = rows.map(({ rowNum, row }) => {
    const city = String(req(row, "city", rowNum)).trim();
    const state = String(req(row, "state", rowNum)).trim();
    const labName = String(req(row, "lab_name", rowNum)).trim();
    const testId = Number(req(row, "test_id", rowNum));
    if (!Number.isFinite(testId) || testId < 1) throw new Error(`Row ${rowNum}: invalid test_id`);

    let discountPct = null;
    try {
      discountPct = parseOptionalDiscountPct(row);
    } catch (e) {
      throw new Error(`Row ${rowNum}: ${e.message}`);
    }

    const mrpInr = row.mrp_inr != null && String(row.mrp_inr).trim() !== "" ? Number(row.mrp_inr) : null;
    if (mrpInr != null && (!Number.isFinite(mrpInr) || mrpInr < 0)) throw new Error(`Row ${rowNum}: invalid mrp_inr`);

    let priceInr =
      row.price_inr != null && String(row.price_inr).trim() !== "" ? Number(row.price_inr) : NaN;

    if (!Number.isFinite(priceInr) || priceInr < 0) {
      const derived = priceFromMrpAndDiscount(mrpInr, discountPct);
      if (derived != null) priceInr = derived;
      else throw new Error(`Row ${rowNum}: missing price_inr (or provide mrp_inr + discount_pct)`);
    }

    if (discountPct == null && mrpInr != null && mrpInr > 0) {
      discountPct = deriveDiscountPct(priceInr, mrpInr);
    }

    return {
      rowNum,
      city,
      state,
      lab_name: labName,
      test_id: Math.floor(testId),
      price_inr: priceInr,
      mrp_inr: mrpInr,
      discount_pct: discountPct,
    };
  });

  return { sheetName, rows: normalized };
}
