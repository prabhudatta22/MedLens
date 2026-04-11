const $ = (id) => document.getElementById(id);

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { ok: res.ok, status: res.status, json };
}

function prefDefaults() {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  d.setHours(9, 0, 0, 0);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`;
}

function applyQueryPrefill() {
  const u = new URL(window.location.href);
  const label = u.searchParams.get("medicine_label");
  const mid = u.searchParams.get("medicine_id");
  if (label) $("medicine_label").value = decodeURIComponent(label);
  if (mid) $("medicine_id").value = mid;
}

async function main() {
  $("remind_at").value = prefDefaults();
  applyQueryPrefill();

  const me = await api("/api/auth/me");
  if (!me.json?.user) {
    $("gate").classList.remove("hidden");
    return;
  }

  $("main").classList.remove("hidden");
  $("userLine").textContent = `Signed in as ${me.json.user.phone_e164}`;

  async function load() {
    const r = await api("/api/reminders");
    if (!r.ok) {
      $("list").innerHTML = `<tr><td colspan="4" class="muted">${escapeHtml(
        r.json?.error || "Failed to load"
      )}</td></tr>`;
      return;
    }
    const items = r.json.reminders || [];
    $("empty").classList.toggle("hidden", items.length > 0);
    $("listWrap").classList.toggle("hidden", items.length === 0);

    $("list").innerHTML = items
      .map((row) => {
        const dt = new Date(row.remind_at);
        const overdue = dt.getTime() < Date.now();
        const repeat =
          row.repeat_interval_days != null ? `${row.repeat_interval_days} days` : "—";
        return `
      <tr class="${overdue ? "best" : ""}">
        <td>
          ${escapeHtml(row.medicine_label)}
          ${row.catalog_name ? `<span class="muted"> · ${escapeHtml(row.catalog_name)}</span>` : ""}
        </td>
        <td class="muted">${escapeHtml(dt.toLocaleString("en-IN"))}${overdue ? " <strong>(due)</strong>" : ""}</td>
        <td class="muted">${escapeHtml(repeat)}</td>
        <td>
          <button type="button" class="btn btn-sm" data-bought="${row.id}">Bought</button>
          <button type="button" class="btn btn-sm" data-del="${row.id}">Remove</button>
        </td>
      </tr>`;
      })
      .join("");

    $("list").querySelectorAll("[data-bought]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-bought");
        await api(`/api/reminders/${id}/bought`, { method: "POST", body: "{}" });
        await load();
      });
    });
    $("list").querySelectorAll("[data-del]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-del");
        if (!confirm("Remove this reminder?")) return;
        await api(`/api/reminders/${id}`, { method: "DELETE" });
        await load();
      });
    });
  }

  $("addForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const medicine_label = $("medicine_label").value.trim();
    const remindLocal = $("remind_at").value;
    if (!remindLocal) return;
    const remind_at = new Date(remindLocal).toISOString();
    const repeatRaw = $("repeat_days").value.trim();
    const repeat_interval_days = repeatRaw === "" ? null : Number(repeatRaw);
    const notes = $("notes").value.trim() || null;
    const medicine_id_raw = $("medicine_id").value.trim();
    const medicine_id = medicine_id_raw === "" ? null : Number(medicine_id_raw);

    const body = {
      medicine_label,
      remind_at,
      repeat_interval_days,
      notes,
    };
    if (medicine_id != null && Number.isFinite(medicine_id)) body.medicine_id = medicine_id;

    const statusEl = $("reminderFormStatus");
    if (statusEl) statusEl.textContent = "";
    const r = await api("/api/reminders", { method: "POST", body: JSON.stringify(body) });
    if (!r.ok) {
      if (statusEl) statusEl.textContent = r.json?.error || "Could not save reminder.";
      return;
    }
    if (statusEl) statusEl.textContent = "";
    $("medicine_id").value = "";
    $("repeat_days").value = "";
    $("notes").value = "";
    $("remind_at").value = prefDefaults();
    await load();
  });

  await load();
}

main().catch(console.error);
