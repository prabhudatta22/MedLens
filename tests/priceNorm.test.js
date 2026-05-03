import assert from "node:assert/strict";
import test from "node:test";

import { enrichOffersWithUnitPricing, pricePerPackUnitInr } from "../server/catalog/priceNorm.js";

test("pricePerPackUnitInr divides by pack_size", () => {
  assert.equal(pricePerPackUnitInr(99, 10), 9.9);
  assert.equal(pricePerPackUnitInr("50.00", "20"), 2.5);
});

test("enrichOffersWithUnitPricing attaches price_per_unit_inr", () => {
  const [row] = enrichOffersWithUnitPricing([{ price_inr: "30", pack_size: 15 }]);
  assert.equal(row.price_per_unit_inr, 2);
});
