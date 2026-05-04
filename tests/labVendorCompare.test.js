import test from "node:test";
import assert from "node:assert/strict";
import { normalizeDiagGroupingKey } from "../server/integrations/labVendorCompare.js";

test("normalizeDiagGroupingKey collapses punctuation and case", () => {
  assert.equal(
    normalizeDiagGroupingKey("  CBC (Complete Blood Count)  "),
    normalizeDiagGroupingKey("cbc complete blood count"),
  );
});
