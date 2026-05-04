/**
 * Diagnostics /labs.html: autocomplete list shows while typing (local catalog).
 *
 * Run: node e2e/labs-diagnostics-suggestions.ui.mjs
 * Requires: Postgres (DATABASE_URL), npm run db:migrate + db:seed (or seeded data).
 */
import { spawn, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.MEDLENS_TEST_PORT || 4032);
const BASE = `http://127.0.0.1:${PORT}`;
const DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://medlens:medlens@127.0.0.1:5432/medlens";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForServer(url, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { redirect: "manual" });
      if (res.status < 500) return;
    } catch {
      /* ignore */
    }
    await sleep(250);
  }
  throw new Error(`Server did not become ready: ${url}`);
}

async function main() {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    console.error("Install Playwright: npm i -D playwright && npx playwright install chromium");
    process.exit(1);
  }

  const mig = spawnSync(process.execPath, ["server/db/migrate.js"], {
    cwd: projectRoot,
    env: { ...process.env, DATABASE_URL },
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (mig.status !== 0) {
    console.error(mig.stderr?.toString() || mig.stdout?.toString());
    throw new Error("db:migrate failed — start Postgres and set DATABASE_URL");
  }

  const seed = spawnSync(process.execPath, ["server/db/seed.js"], {
    cwd: projectRoot,
    env: { ...process.env, DATABASE_URL },
    stdio: "inherit",
  });
  if (seed.status !== 0) throw new Error("db:seed failed");

  const child = spawn("node", ["server/index.js"], {
    cwd: projectRoot,
    env: { ...process.env, PORT: String(PORT), DATABASE_URL, NODE_ENV: "development" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const kill = () => {
    try {
      child.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  };
  process.on("exit", kill);

  try {
    await waitForServer(`${BASE}/`);

    const apiRes = await fetch(`${BASE}/api/labs/tests/suggest?q=cb`);
    const apiJson = await apiRes.json().catch(() => ({}));
    if (!apiRes.ok) throw new Error(`suggest API HTTP ${apiRes.status}: ${JSON.stringify(apiJson)}`);
    const items = apiJson.items || [];
    if (!items.length) {
      throw new Error("suggest API returned no items for q=cb (seed lab_tests missing?)");
    }
    console.log(`API OK: /api/labs/tests/suggest?q=cb → ${items.length} item(s).`);

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    await page.goto(`${BASE}/labs.html`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForFunction(() => document.querySelectorAll("#labCity option").length > 0, {
      timeout: 15_000,
    });

    await page.locator("#labQ").click();
    // Single-shot input must still trigger the debounced suggest fetch (Playwright fires `input`).
    await page.locator("#labQ").fill("cbc");
    await page.locator("#labQ-suggestions:not(.hidden) .suggestion").first().waitFor({
      state: "visible",
      timeout: 12_000,
    });

    const vis = await page.locator("#labQ-suggestions .suggestion").count();
    if (vis < 1) throw new Error("Expected at least one visible suggestion row in UI");

    await browser.close();
    console.log("UI OK: diagnostics suggestion list visible after typing.");
    console.log("\nLabs diagnostics suggestions smoke test: PASSED");
  } catch (e) {
    console.error("Labs diagnostics suggestions smoke test: FAILED", e?.message || e);
    process.exitCode = 1;
  } finally {
    kill();
    await sleep(200);
  }
}

main();
