import assert from "node:assert/strict";
import test from "node:test";

import { ensureCatalogIntelligence, resetCatalogIntelligenceForTests } from "../server/catalog/ensureIntel.js";

test("ensureCatalogIntelligence retries after a transient first-run failure", async (t) => {
  resetCatalogIntelligenceForTests();
  t.after(resetCatalogIntelligenceForTests);

  let calls = 0;
  const pool = {
    async query() {
      calls += 1;
      if (calls === 1) throw new Error("temporary database outage");
      return { rows: [] };
    },
  };

  await assert.rejects(ensureCatalogIntelligence(pool), /temporary database outage/);
  await assert.doesNotReject(ensureCatalogIntelligence(pool));
  assert.equal(calls, 4);
});
