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

export function parsePricesXlsx(buffer) {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("No worksheet found");
  const ws = wb.Sheets[sheetName];

  // Read as array-of-arrays first, normalize headers, then build objects.
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
  if (!aoa.length) throw new Error("Sheet is empty");

  const headersRaw = aoa[0];
  const headers = headersRaw.map(normHeader);
  const rows = [];

  for (let i = 1; i < aoa.length; i += 1) {
    const line = aoa[i];
    if (!line || line.every((c) => c === undefined || c === null || String(c).trim() === "")) {
      continue;
    }
    const obj = {};
    for (let c = 0; c < headers.length; c += 1) {
      const k = headers[c];
      if (!k) continue;
      obj[k] = line[c];
    }
    rows.push({ rowNum: i + 1, row: obj });
  }

  // Expected long-format headers (minimum):
  // city, state, pharmacy_name, drug_name, strength, form, pack_size
  // price_inr — or omit if mrp_inr + discount_pct are provided (price will be derived)
  // optional: chain, address_line, pincode, lat, lng, mrp_inr, discount_pct, price_type, in_stock
  const normalized = rows.map(({ rowNum, row }) => {
    const city = String(req(row, "city", rowNum)).trim();
    const state = String(req(row, "state", rowNum)).trim();
    const pharmacyName = String(req(row, "pharmacy_name", rowNum)).trim();

    const chain = row.chain != null && String(row.chain).trim() !== "" ? String(row.chain).trim() : null;
    const addressLine =
      row.address_line != null && String(row.address_line).trim() !== ""
        ? String(row.address_line).trim()
        : null;
    const pincode = row.pincode != null && String(row.pincode).trim() !== "" ? String(row.pincode).trim() : null;

    const lat = row.lat != null && String(row.lat).trim() !== "" ? Number(row.lat) : null;
    const lng = row.lng != null && String(row.lng).trim() !== "" ? Number(row.lng) : null;

    const drugName = String(req(row, "drug_name", rowNum)).trim();
    const genericName =
      row.generic_name != null && String(row.generic_name).trim() !== ""
        ? String(row.generic_name).trim()
        : null;
    const strength = String(req(row, "strength", rowNum)).trim();
    const form = row.form != null && String(row.form).trim() !== "" ? String(row.form).trim() : "tablet";
    const packSize = row.pack_size != null && String(row.pack_size).trim() !== "" ? Number(row.pack_size) : 10;

    let discountPct = null;
    try {
      discountPct = parseOptionalDiscountPct(row);
    } catch (e) {
      throw new Error(`Row ${rowNum}: ${e.message}`);
    }

    const mrpInr = row.mrp_inr != null && String(row.mrp_inr).trim() !== "" ? Number(row.mrp_inr) : null;
    if (mrpInr != null && (!Number.isFinite(mrpInr) || mrpInr < 0)) throw new Error(`Row ${rowNum}: invalid mrp_inr`);

    let priceInr =
      row.price_inr != null && String(row.price_inr).trim() !== ""
        ? Number(row.price_inr)
        : NaN;

    if (!Number.isFinite(priceInr) || priceInr < 0) {
      const derived = priceFromMrpAndDiscount(mrpInr, discountPct);
      if (derived != null) priceInr = derived;
      else throw new Error(`Row ${rowNum}: missing price_inr (or provide mrp_inr + discount_pct to derive price)`);
    }

    if (discountPct == null && mrpInr != null && mrpInr > 0) {
      discountPct = deriveDiscountPct(priceInr, mrpInr);
    }

    const priceType =
      row.price_type != null && String(row.price_type).trim() !== ""
        ? String(row.price_type).trim().toLowerCase()
        : "retail";
    const inStock =
      row.in_stock == null || String(row.in_stock).trim() === ""
        ? true
        : ["true", "1", "yes", "y"].includes(String(row.in_stock).trim().toLowerCase());

    if (!Number.isFinite(priceInr) || priceInr < 0) throw new Error(`Row ${rowNum}: invalid price_inr`);
    if (lat != null && !Number.isFinite(lat)) throw new Error(`Row ${rowNum}: invalid lat`);
    if (lng != null && !Number.isFinite(lng)) throw new Error(`Row ${rowNum}: invalid lng`);

    return {
      rowNum,
      city,
      state,
      pharmacy: { name: pharmacyName, chain, address_line: addressLine, pincode, lat, lng },
      medicine: {
        display_name: drugName,
        generic_name: genericName,
        strength,
        form,
        pack_size: Number.isFinite(packSize) && packSize > 0 ? Math.floor(packSize) : 10,
      },
      price: {
        price_inr: priceInr,
        mrp_inr: mrpInr,
        discount_pct: discountPct,
        price_type: priceType,
        in_stock: inStock,
      },
    };
  });

  return { sheetName, rows: normalized };
}

