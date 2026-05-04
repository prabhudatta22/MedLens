import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("diagnostics webhook is mounted with a JSON body parser", async () => {
  const source = await readFile(new URL("../server/index.js", import.meta.url), "utf8");
  const diagnosticsMount = source.indexOf(
    'app.use("/webhook/diagnostics", express.json({ limit: "2mb" }), diagnosticsWebhook)'
  );
  const globalJsonMount = source.indexOf('app.use(express.json({ limit: "2mb" }))');

  assert.notEqual(diagnosticsMount, -1);
  assert.notEqual(globalJsonMount, -1);
  assert.ok(
    diagnosticsMount < globalJsonMount,
    "diagnostics webhook must parse JSON before the global parser mounted later"
  );
});
