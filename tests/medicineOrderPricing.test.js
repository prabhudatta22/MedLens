import assert from "node:assert/strict";
import test from "node:test";

import {
  loadAuthoritativeMedicineOrderItems,
  totalMedicineOrderItemsPaise,
} from "../server/orders/medicineOrderPricing.js";

function fakeDb(row) {
  return {
    calls: [],
    async query(sql, params) {
      this.calls.push({ sql, params });
      return { rows: row ? [row] : [] };
    },
  };
}

test("medicine order pricing ignores tampered client unit price", async () => {
  const db = fakeDb({
    price_inr: "125.50",
    mrp_inr: "150.00",
    in_stock: true,
    display_name: "Paracetamol 650",
    strength: "650 mg",
    form: "tablet",
    pack_size: 10,
  });

  const items = await loadAuthoritativeMedicineOrderItems(db, [
    {
      pharmacyId: 7,
      medicineId: 11,
      quantity: 2,
      unitPriceInr: 1,
      medicineLabel: "Tampered label",
    },
  ]);

  assert.equal(db.calls[0].params[0], 7);
  assert.equal(db.calls[0].params[1], 11);
  assert.equal(items[0].unit_price_inr, 125.5);
  assert.equal(items[0].item_label, "Paracetamol 650");
  assert.equal(totalMedicineOrderItemsPaise(items), 25100);
});

test("medicine order pricing rejects unavailable pharmacy medicine pair", async () => {
  await assert.rejects(
    () => loadAuthoritativeMedicineOrderItems(fakeDb(null), [{ pharmacyId: 7, medicineId: 11, quantity: 1 }]),
    /no longer available/
  );
});
