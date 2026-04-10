import { cartLineCount } from "./cartStore.js";
import { clearCachedUser, fetchAndCacheUser, loadCachedUser } from "./authProfile.js";

const $ = (id) => document.getElementById(id);

const MIN_QUERY_LEN = 2;
const DEBOUNCE_MS = 380;
const SUGGEST_MIN_QUERY_LEN = 3;
const SUGGEST_DEBOUNCE_MS = 180;
const RECENT_KEY = "medlens_recent_lab_searches_v1";
const RECENT_MAX = 6;

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

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, "&#39;");
}

function fmtINR(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  return `₹${x.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function loadRecent() {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function saveRecent(q) {
  const s = String(q || "").trim();
  if (!s) return;
  const arr = loadRecent().filter((x) => x.toLowerCase() !== s.toLowerCase());
  arr.unshift(s);
  const next = arr.slice(0, RECENT_MAX);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  renderRecent();
}

function renderRecent() {
  const host = document.querySelector('.quick-chips[aria-label="Popular"]');
  if (!host) return;
  const existing = host.querySelector(".recent-chip-group");
  if (existing) existing.remove();
  const recent = loadRecent();
  if (!recent.length) return;
  const wrap = document.createElement("div");
  wrap.className = "recent-chip-group";
  wrap.style.display = "contents";
  recent.slice(0, 4).forEach((q) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip";
    btn.textContent = q;
    btn.addEventListener("click", () => {
      const input = $("labQ");
      if (!input) return;
      input.value = q;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.focus();
    });
    wrap.appendChild(btn);
  });
  host.appendChild(wrap);
}

async function uploadDiagnosticsPrescriptionAndExtract() {
  const fileEl = $("labRxFile");
  const btn = $("labRxUploadBtn");
  const status = $("labRxStatus");
  const out = $("labRxMatches");
  const city = $("labCity")?.value || "";
  if (!fileEl || !btn || !status || !out) return;

  const file = fileEl.files?.[0];
  if (!file) {
    status.textContent = "Choose an image/PDF first.";
    return;
  }
  if (!city) {
    status.textContent = "Choose a city first.";
    return;
  }

  btn.disabled = true;
  status.textContent = "Extracting tests from image…";
  out.classList.add("hidden");
  out.innerHTML = "";

  try {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`/api/labs/prescription/ocr?city=${encodeURIComponent(city)}`, { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      status.textContent = data.error || `OCR failed (${res.status})`;
      btn.disabled = false;
      return;
    }
    const matches = data.matches || [];
    if (!matches.length) {
      status.textContent = "No tests confidently matched. Try a clearer photo (printed text works best).";
      btn.disabled = false;
      return;
    }
    status.textContent = `Matched ${matches.length} test(s). Click one to search.`;
    out.innerHTML = matches
      .map((m, idx) => {
        const extra = [m.lab_name ? `Lab: ${m.lab_name}` : "", m.price_inr != null ? fmtINR(m.price_inr) : ""]
          .filter(Boolean)
          .join(" · ");
        const line = m.match_line ? `Matched line: ${m.match_line}` : "";
        return `
          <div class="rx-match">
            <div>
              <div class="rx-match-title">${escapeHtml(m.heading || "")}</div>
              <div class="rx-match-sub muted">${escapeHtml(m.sub_heading || "")}${
                extra ? ` · ${escapeHtml(extra)}` : ""
              }${line ? ` · ${escapeHtml(line)}` : ""}</div>
            </div>
            <button type="button" class="btn btn-sm btn-primary dxrx-pick" data-idx="${idx}">Search</button>
          </div>`;
      })
      .join("");
    out.classList.remove("hidden");
    out.querySelectorAll(".dxrx-pick").forEach((b) => {
      b.addEventListener("click", () => {
        const idx = Number(b.dataset.idx);
        const m = matches[idx];
        if (!m?.heading) return;
        $("labQ").value = String(m.heading);
        closeSuggestions?.();
        runSearch();
      });
    });
  } catch (e) {
    status.textContent = String(e?.message || e);
  } finally {
    btn.disabled = false;
  }
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
  const ordersEl = $("navOrders");
  const profileWrapEl = $("navProfileWrap");
  if (!userEl || !loginEl || !logoutEl) return;

  const u = currentUser;
  const isLogged = Boolean(u);
  loginEl.classList.toggle("hidden", isLogged);
  logoutEl.classList.toggle("hidden", !isLogged);
  userEl.classList.toggle("hidden", !isLogged);
  // Orders are for consumer users only (OTP/Google). Hide for logged-out and service providers.
  if (ordersEl) ordersEl.classList.toggle("hidden", !(isLogged && u?.role !== "service_provider"));
  if (profileWrapEl) profileWrapEl.classList.toggle("hidden", !(isLogged && u?.role !== "service_provider"));

  if (!isLogged) {
    userEl.textContent = "";
    return;
  }
  userEl.textContent =
    u.role === "service_provider"
      ? `SP · ${u.username || "account"}`
      : u.full_name
        ? `${u.full_name}`
      : u.email
        ? `${u.email}`
      : u.phone_e164
        ? `${u.phone_e164}`
        : "Account";
}

async function refreshAuth() {
  currentUser = loadCachedUser();
  renderAuthNav();
  currentUser = await fetchAndCacheUser();
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
  saveRecent(q);

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

function renderIntents(intents) {
  const row = $("labIntentRow");
  if (!row) return;
  if (!Array.isArray(intents) || intents.length === 0) {
    row.classList.add("hidden");
    row.innerHTML = "";
    return;
  }
  row.classList.remove("hidden");
  row.innerHTML = intents
    .slice(0, 6)
    .map((it) => `<button type="button" class="chip" data-intent="${escapeHtml(it.id)}">${escapeHtml(it.label)}</button>`)
    .join("");
  row.querySelectorAll("button[data-intent]").forEach((b) => {
    b.addEventListener("click", () => {
      const label = b.textContent || "";
      const input = $("labQ");
      if (!input) return;
      input.value = label;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.focus();
    });
  });
}

let intentTimer;
async function refreshIntentHints() {
  const q = $("labQ")?.value?.trim() || "";
  const city = $("labCity")?.value || "";
  if (!city || q.length < 2) {
    renderIntents([]);
    return;
  }
  try {
    const res = await fetch(`/api/labs/intent?q=${encodeURIComponent(q)}&city=${encodeURIComponent(city)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      renderIntents([]);
      return;
    }
    renderIntents(data.intents || []);
  } catch {
    renderIntents([]);
  }
}

// --- Autocomplete suggestions (3+ chars) ---
let suggestTimer;
/** @type {AbortController | null} */
let suggestAbort = null;
let suggestItems = [];
let suggestActive = -1;

function getSuggestEls() {
  const input = $("labQ");
  const box = $("labQ-suggestions");
  return { input, box };
}

function closeSuggestions() {
  const { input, box } = getSuggestEls();
  if (!input || !box) return;
  box.classList.add("hidden");
  box.innerHTML = "";
  input.setAttribute("aria-expanded", "false");
  input.removeAttribute("aria-activedescendant");
  suggestItems = [];
  suggestActive = -1;
}

function openSuggestions() {
  const { input, box } = getSuggestEls();
  if (!input || !box) return;
  box.classList.remove("hidden");
  input.setAttribute("aria-expanded", "true");
}

function renderSuggestions(items, q) {
  const { input, box } = getSuggestEls();
  if (!input || !box) return;

  if (!Array.isArray(items) || items.length === 0) {
    closeSuggestions();
    return;
  }

  suggestItems = items.slice(0, 10);
  suggestActive = -1;
  openSuggestions();

  const qLower = String(q || "").toLowerCase();
  box.innerHTML = suggestItems
    .map((it, idx) => {
      const id = `labQ-sug-${idx}`;
      const heading = String(it.heading || "").trim();
      const sub = String(it.sub_heading || "").trim();
      const headingLower = heading.toLowerCase();
      const hitAt = qLower && headingLower.includes(qLower) ? headingLower.indexOf(qLower) : -1;
      const label =
        hitAt >= 0 && qLower.length
          ? `${escapeHtml(heading.slice(0, hitAt))}<mark>${escapeHtml(
              heading.slice(hitAt, hitAt + qLower.length)
            )}</mark>${escapeHtml(heading.slice(hitAt + qLower.length))}`
          : escapeHtml(heading);
      return `
        <div class="suggestion" role="option" id="${escapeAttr(id)}" data-idx="${idx}" aria-selected="false">
          <div class="suggestion-title">${label}</div>
          ${sub ? `<div class="suggestion-sub muted">${escapeHtml(sub)}</div>` : ""}
        </div>`;
    })
    .join("");

  box.querySelectorAll(".suggestion").forEach((row) => {
    row.addEventListener("mousedown", (e) => e.preventDefault());
    row.addEventListener("click", () => {
      const idx = Number(row.dataset.idx);
      pickSuggestion(idx);
    });
  });
}

function setActiveSuggestion(nextIdx) {
  const { input, box } = getSuggestEls();
  if (!input || !box) return;
  const rows = [...box.querySelectorAll(".suggestion")];
  if (!rows.length) return;
  suggestActive = Math.max(0, Math.min(nextIdx, rows.length - 1));
  rows.forEach((el, i) => el.setAttribute("aria-selected", i === suggestActive ? "true" : "false"));
  const activeEl = rows[suggestActive];
  if (activeEl?.id) input.setAttribute("aria-activedescendant", activeEl.id);
  activeEl?.scrollIntoView?.({ block: "nearest" });
}

function pickSuggestion(idx) {
  const { input } = getSuggestEls();
  if (!input) return;
  const it = suggestItems[idx];
  const heading = String(it?.heading || "").trim();
  if (!heading) return;
  input.value = heading;
  closeSuggestions();
  clearTimeout(t);
  runSearch();
}

async function runSuggestSearch() {
  const { input } = getSuggestEls();
  if (!input) return;
  const q = input.value.trim();

  if (!q || q.length < SUGGEST_MIN_QUERY_LEN) {
    closeSuggestions();
    return;
  }

  if (suggestAbort) suggestAbort.abort();
  suggestAbort = new AbortController();
  const signal = suggestAbort.signal;

  const city = $("labCity")?.value || "";
  const params = new URLSearchParams({ q, city });
  if (selectedCategory) params.set("category", selectedCategory);

  try {
    // Reuse labs search endpoint for suggestions (we only display top results).
    const res = await fetch(`/api/labs/search?${params.toString()}`, { signal });
    const data = await res.json().catch(() => ({}));
    if (signal.aborted) return;
    if (!res.ok) {
      closeSuggestions();
      return;
    }
    renderSuggestions(data.items || [], q);
  } catch (e) {
    if (e?.name === "AbortError") return;
    closeSuggestions();
  }
}

$("labQ").addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    const { box } = getSuggestEls();
    if (!box || box.classList.contains("hidden")) return;
    e.preventDefault();
    const delta = e.key === "ArrowDown" ? 1 : -1;
    setActiveSuggestion((suggestActive < 0 ? -1 : suggestActive) + delta);
    return;
  }
  if (e.key === "Escape") {
    const { box } = getSuggestEls();
    if (box && !box.classList.contains("hidden")) {
      e.preventDefault();
      closeSuggestions();
      return;
    }
  }
  if (e.key !== "Enter") return;
  const { box } = getSuggestEls();
  if (box && !box.classList.contains("hidden")) {
    const rows = box.querySelectorAll(".suggestion");
    if (rows.length && suggestActive >= 0) {
      e.preventDefault();
      pickSuggestion(suggestActive);
      return;
    }
  }
});

$("labQ").addEventListener("input", () => {
  scheduleSearch();
  clearTimeout(intentTimer);
  intentTimer = setTimeout(refreshIntentHints, 220);
  clearTimeout(suggestTimer);
  suggestTimer = setTimeout(runSuggestSearch, SUGGEST_DEBOUNCE_MS);
});

$("labQ").addEventListener("blur", () => setTimeout(() => closeSuggestions(), 120));

$("labCity").addEventListener("change", runSearch);

async function initLabsPage() {
  await loadCities();
  await refreshAuth();
  await loadCategories();
  refreshCartBadge();
  renderRecent();

  $("navLogout")?.addEventListener("click", async (e) => {
    e.preventDefault();
    await postJson("/api/auth/logout", {});
    clearCachedUser();
    currentUser = null;
    renderAuthNav();
  });

  $("labRxUploadBtn")?.addEventListener("click", () => uploadDiagnosticsPrescriptionAndExtract());

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
}

initLabsPage().catch((e) => {
  setStatus(String(e?.message || e));
});

