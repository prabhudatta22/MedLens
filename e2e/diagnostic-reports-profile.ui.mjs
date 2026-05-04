/**
 * Smoke: dummy OTP login (+919100946364 / 12345) → Profile → Diagnostic reports lists DB rows for that user.
 *
 * Run: node e2e/diagnostic-reports-profile.ui.mjs
 * Requires: playwright chromium (`npx playwright install chromium`), DATABASE_URL (e.g. from .env).
 */
import "dotenv/config";
import { spawn, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.MEDLENS_TEST_PORT || 4032);
const BASE = `http://127.0.0.1:${PORT}`;
const DATABASE_URL = process.env.DATABASE_URL || "";

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

async function reportCountForDummyPhone(pool) {
  const phone = "+919100946364";
  const u = await pool.query(`SELECT id FROM users WHERE phone_e164 = $1 LIMIT 1`, [phone]);
  if (!u.rows.length) return { userId: null, count: 0 };
  const uid = u.rows[0].id;
  const c = await pool.query(
    `SELECT COUNT(*)::int AS c FROM user_diagnostic_reports WHERE user_id = $1`,
    [uid]
  );
  return { userId: uid, count: Number(c.rows[0]?.c) || 0 };
}

async function main() {
  if (!DATABASE_URL) {
    console.error("Set DATABASE_URL (e.g. copy from .env)");
    process.exit(1);
  }

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
    throw new Error("db:migrate failed");
  }

  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  let expected;
  try {
    expected = await reportCountForDummyPhone(pool);
  } finally {
    await pool.end();
  }

  console.log(`DB: user +919100946364 id=${expected.userId ?? "n/a"}, diagnostic_reports=${expected.count}`);

  const server = spawn(process.execPath, ["server/index.js"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      DATABASE_URL,
      PORT: String(PORT),
      /** Avoid noisy ECONNREFUSED logs when local Redis is not running (consumer OTP does not need Redis). */
      REDIS_URL: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  server.stderr?.on("data", (c) => {
    stderr += c.toString();
  });

  try {
    await waitForServer(`${BASE}/login.html`);

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(`${BASE}/login.html`, { waitUntil: "domcontentloaded" });
    await page.locator("#phone").fill("9100946364");
    await page.getByRole("button", { name: "Send OTP" }).click();
    await page.locator("#verifyPanel").waitFor({ state: "visible", timeout: 15_000 });
    await page.locator("#code").fill("12345");
    await page.getByRole("button", { name: "Verify & login" }).click();
    await page.waitForURL((u) => !String(u.pathname).includes("login"), { timeout: 20_000 });

    await page.goto(`${BASE}/profile.html?view=reports`, { waitUntil: "networkidle" });

    const wrap = page.locator("[data-diagnostic-reports-wrap]");
    await wrap.waitFor({ state: "visible", timeout: 15_000 });

    const rows = wrap.locator("table.price-table tbody tr");
    const rowCount = await rows.count();

    const profileApi = await page.evaluate(async () => {
      const r = await fetch("/api/profile", { credentials: "same-origin" });
      const j = await r.json().catch(() => ({}));
      return { ok: r.ok, status: r.status, n: Array.isArray(j.diagnostic_reports) ? j.diagnostic_reports.length : -1 };
    });

    if (!profileApi.ok) {
      throw new Error(`GET /api/profile failed: ${profileApi.status} ${JSON.stringify(profileApi)}`);
    }

    if (profileApi.n !== expected.count) {
      throw new Error(`Profile API diagnostic_reports length ${profileApi.n} != DB count ${expected.count}`);
    }

    if (expected.count > 0 && rowCount === 0) {
      const statusText = await page.locator("[data-diagnostic-reports-status]").textContent();
      throw new Error(
        `Expected UI table rows for ${expected.count} report(s), got 0. Status: ${statusText || "(empty)"}`
      );
    }

    if (expected.count === 0 && rowCount > 0) {
      throw new Error(`DB has 0 reports but UI shows ${rowCount} row(s)`);
    }

    await browser.close();
    console.log("PASS: login + profile reports section matches DB.", {
      uiTableRows: rowCount,
      apiReports: profileApi.n,
      dbReports: expected.count,
    });
  } finally {
    server.kill("SIGTERM");
    await sleep(300);
    server.kill("SIGKILL");
    if (stderr.trim()) console.warn("Server stderr (tail):\n", stderr.slice(-2000));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
