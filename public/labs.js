import { cartLineCount } from "./cartStore.js";

const $ = (id) => document.getElementById(id);

const MIN_QUERY_LEN = 2;
const DEBOUNCE_MS = 380;

let cities = [];
let selectedCategory = "";
let t = null;

const DEFAULT_METRO_CITIES = [
  { slug: "mumbai", name: "Mumbai", state: "Maharashtra" },
  { slug: "bengaluru", name: "Bengaluru", state: "Karnataka" },
  { slug: "new-delhi", name: "New Delhi", state: "Delhi" },
];

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtINR(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  return `₹${x.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function refreshCartBadge() {
  const n = cartLineCount();
  const el = $("cartBadge");
  if (!el) return;
  el.textContent = String(n);
  el.classList.toggle("hidden", n === 0);
}

let currentUser = null;

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

function renderAuthNav() {
  const userEl = $("navUser");
  const loginEl = $("navLogin");
  const logoutEl = $("navLogout");
  if (!userEl || !loginEl || !logoutEl) return;

  const u = currentUser;
  const isLogged = Boolean(u);
  loginEl.classList.toggle("hidden", isLogged);
  logoutEl.classList.toggle("hidden", !isLogged);
  userEl.classList.toggle("hidden", !isLogged);

  if (!isLogged) {
    userEl.textContent = "";
    return;
  }
  userEl.textContent =
    u.role === "service_provider"
      ? `SP · ${u.username || "account"}`
      : u.phone_e164
        ? `${u.phone_e164}`
        : "Account";
}

async function refreshAuth() {
  try {
    const res = await fetch("/api/auth/me", { credentials: "same-origin" });
    const data = await res.json();
    currentUser = data.user || null;
  } catch {
    currentUser = null;
  }
  renderAuthNav();
}

async function loadCities() {
  try {
    const res = await fetch("/api/cities");
    const data = await res.json().catch(() => ({}));
    cities = data.cities || [];
  } catch {
    cities = [];
  }

  if (!Array.isArray(cities) || cities.length === 0) {
    cities = DEFAULT_METRO_CITIES.slice();
  }
  const sel = $("labCity");
  sel.innerHTML = cities
    .map((c) => `<option value="${escapeHtml(c.slug)}">${escapeHtml(c.name)}, ${escapeHtml(c.state)}</option>`)
    .join("");
}

async function loadCategories() {
  const res = await fetch("/api/labs/categories");
  const data = await res.json();
  const cats = data.categories || ["PATHOLOGY"];
  $("labCats").innerHTML = cats
    .map((c) => {
      const active = c === selectedCategory ? " active" : "";
      return `<button type="button" class="chip${active}" data-cat="${escapeHtml(c)}">${escapeHtml(c)}</button>`;
    })
    .join("");

  $("labCats").querySelectorAll("button[data-cat]").forEach((b) => {
    b.addEventListener("click", () => {
      const c = b.getAttribute("data-cat") || "";
      selectedCategory = selectedCategory === c ? "" : c;
      loadCategories();
      runSearch();
    });
  });
}

function setStatus(msg) {
  $("labStatus").textContent = msg || "";
}

function render(items) {
  const grid = $("labGrid");
  const empty = $("labEmpty");
  if (!items.length) {
    grid.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  grid.innerHTML = items
    .map((it) => {
      const price = Number(it.price_inr);
      const mrp = it.mrp_inr != null ? Number(it.mrp_inr) : null;
      const hasDiscount = mrp != null && mrp > price && price > 0;
      const pct = hasDiscount ? Math.round(((mrp - price) / mrp) * 100) : null;
      const tat = it.report_tat_hours != null ? `${escapeHtml(it.report_tat_hours)} hrs` : "—";
      const home = it.home_collection ? "Home collection" : "Lab visit";
      const slug = it.slug || "";
      const openUrl = slug ? `https://www.1mg.com${slug}` : "#";

      return `
      <article class="lab-card">
        <div class="lab-card-top">
          <div class="lab-icowrap">
            ${it.icon_url ? `<img src="${escapeHtml(it.icon_url)}" alt="" loading="lazy" />` : `<span>🧪</span>`}
          </div>
          <div class="lab-meta">
            <div class="lab-title">${escapeHtml(it.heading)}</div>
            <div class="lab-sub muted">${escapeHtml(it.sub_heading || "")}</div>
            <div class="lab-badges">
              <span class="pill">${escapeHtml(it.lab_name || "Lab")}</span>
              <span class="pill pill-muted">${escapeHtml(home)}</span>
              <span class="pill pill-muted">Report: ${tat}</span>
              ${hasDiscount ? `<span class="pill pill-deal">${pct}% OFF</span>` : ""}
            </div>
          </div>
        </div>
        <div class="lab-card-bottom">
          <div class="lab-price">
            <div class="lab-price-now">${escapeHtml(fmtINR(price))}</div>
            <div class="lab-price-was muted">${hasDiscount ? `<s>${escapeHtml(fmtINR(mrp))}</s>` : ""}</div>
          </div>
          <div class="lab-actions">
            <a class="btn btn-sm btn-ghost" href="${escapeHtml(openUrl)}" target="_blank" rel="noopener noreferrer">Open</a>
            <button type="button" class="btn btn-sm btn-primary" data-book="${escapeHtml(it.id)}">Book</button>
          </div>
        </div>
      </article>`;
    })
    .join("");

  // Demo action
  grid.querySelectorAll("button[data-book]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const name = btn.closest(".lab-card")?.querySelector(".lab-title")?.textContent || "Test";
      alert(`Demo: booking flow not implemented.\n\nSelected: ${name}\n\nNext: patient profile, slots, payment, and partner lab integration.`);
    });
  });
}

async function runSearch() {
  const q = $("labQ").value.trim();
  const city = $("labCity").value;

  if (!q) {
    setStatus("Type a test name to search (e.g. CBC).");
    render([]);
    return;
  }
  if (q.length < MIN_QUERY_LEN) {
    setStatus(`Enter at least ${MIN_QUERY_LEN} characters to search.`);
    render([]);
    return;
  }

  setStatus("Searching…");

  const params = new URLSearchParams({ q, city });
  if (selectedCategory) params.set("category", selectedCategory);

  try {
    const res = await fetch(`/api/labs/search?${params.toString()}`);
    const data = await res.json();
    if (!res.ok) {
      setStatus(data.error || `Search failed (${res.status})`);
      render([]);
      return;
    }
    setStatus(`Showing results for “${q}” in ${city}${selectedCategory ? ` · ${selectedCategory}` : ""}.`);
    render(data.items || []);
  } catch (e) {
    setStatus(String(e?.message || e));
    render([]);
  }
}

function scheduleSearch() {
  clearTimeout(t);
  t = setTimeout(runSearch, DEBOUNCE_MS);
}

$("labQ").addEventListener("input", scheduleSearch);
$("labCity").addEventListener("change", runSearch);

await loadCities();
await refreshAuth();
await loadCategories();
refreshCartBadge();

$("navLogout")?.addEventListener("click", async (e) => {
  e.preventDefault();
  await postJson("/api/auth/logout", {});
  currentUser = null;
  renderAuthNav();
});

// Support deep-link from home page: /labs.html?q=...&city=...&category=...
const params = new URLSearchParams(window.location.search);
const q0 = (params.get("q") || "").trim();
const city0 = (params.get("city") || "").trim();
const cat0 = (params.get("category") || "").trim().toUpperCase();
if (city0 && $("labCity") && [...$("labCity").options].some((o) => o.value === city0)) {
  $("labCity").value = city0;
}
if (cat0 === "PATHOLOGY" || cat0 === "RADIOLOGY") {
  selectedCategory = cat0;
  await loadCategories();
}
if (q0) {
  $("labQ").value = q0;
  runSearch();
} else {
  setStatus("Type a test name to search (e.g. CBC).");
}

