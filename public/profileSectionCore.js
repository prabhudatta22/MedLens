/** Shared profile API helpers + section renderers (used by profile shell and embed pages). */

export function $(id) {
  return document.getElementById(id);
}

export async function request(url, options = {}) {
  const res = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export function setStatus(id, msg) {
  const el = $(id);
  if (el) el.textContent = msg || "";
}

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function fmtTs(s) {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

export function renderAbhaSection(abha) {
  const linked = Boolean(abha?.linked);
  const linkedPanel = $("abhaLinkedPanel");
  const linkPanel = $("abhaLinkPanel");
  linkedPanel?.classList.toggle("hidden", !linked);
  linkPanel?.classList.toggle("hidden", linked);
  if (linked) {
    const m = $("abhaMaskedDisplay");
    if (m) m.textContent = abha.health_id_masked || "—";
    const meta = $("abhaSyncMeta");
    if (meta) {
      const parts = [];
      if (abha.last_sync_at) parts.push(`Last sync: ${fmtTs(abha.last_sync_at)}`);
      if (abha.aadhaar_verified_at) parts.push(`Verified: ${fmtTs(abha.aadhaar_verified_at)}`);
      meta.textContent = parts.length ? ` · ${parts.join(" · ")}` : "";
    }
  } else {
    const txn = $("abhaTxnId");
    if (txn) txn.value = "";
    const otpIn = $("abhaOtpInput");
    if (otpIn) otpIn.value = "";
    $("abhaOtpPanel")?.classList.add("hidden");
  }
}

export function renderAddresses(addresses, afterMutation) {
  const host = $("addressList");
  if (!host) return;
  if (!addresses?.length) {
    host.innerHTML = `<p class="muted">No saved addresses yet.</p>`;
    return;
  }
  host.innerHTML = addresses
    .map(
      (a) => `
      <div class="rx-match">
        <div>
          <div class="rx-match-title">${escapeHtml(a.label || "Address")}${a.is_default ? ` <span class="muted">· default</span>` : ""}</div>
          <div class="rx-match-sub muted">
            ${escapeHtml(a.address_line1)}${a.landmark ? `, ${escapeHtml(a.landmark)}` : ""}${a.city ? `, ${escapeHtml(a.city)}` : ""}
            ${a.state ? `, ${escapeHtml(a.state)}` : ""}${a.pincode ? ` - ${escapeHtml(a.pincode)}` : ""}
          </div>
        </div>
        <div class="auth-actions">
          <button type="button" class="btn btn-sm btn-ghost addr-default" data-id="${a.id}">Set default</button>
          <button type="button" class="btn btn-sm btn-ghost addr-delete" data-id="${a.id}">Delete</button>
        </div>
      </div>`,
    )
    .join("");

  host.querySelectorAll(".addr-default").forEach((b) => {
    b.addEventListener("click", async () => {
      const id = Number(b.dataset.id);
      const r = await request(`/api/profile/addresses/${id}/default`, { method: "POST", body: "{}" });
      if (!r.ok) return setStatus("addressStatus", r.data?.error || "Failed to set default address");
      setStatus("addressStatus", "Default address updated.");
      await afterMutation?.();
    });
  });
  host.querySelectorAll(".addr-delete").forEach((b) => {
    b.addEventListener("click", async () => {
      const id = Number(b.dataset.id);
      const r = await request(`/api/profile/addresses/${id}`, { method: "DELETE" });
      if (!r.ok) return setStatus("addressStatus", r.data?.error || "Failed to delete address");
      setStatus("addressStatus", "Address deleted.");
      await afterMutation?.();
    });
  });
}

export function renderPaymentMethods(methods, afterMutation) {
  const host = $("paymentList");
  if (!host) return;
  if (!methods?.length) {
    host.innerHTML = `<p class="muted">No payment methods saved yet.</p>`;
    return;
  }
  host.innerHTML = methods
    .map((m) => {
      const title =
        m.method_type === "upi"
          ? `${m.label || "UPI"} · ${m.upi_id || ""}`
          : `${m.label || "Card"} · **** ${m.card_last4 || "----"}${m.card_network ? ` (${m.card_network})` : ""}`;
      return `
        <div class="rx-match">
          <div>
            <div class="rx-match-title">${escapeHtml(title)}${m.is_default ? ` <span class="muted">· default</span>` : ""}</div>
            <div class="rx-match-sub muted">Provider: Razorpay</div>
          </div>
          <div class="auth-actions">
            <button type="button" class="btn btn-sm btn-ghost pm-default" data-id="${m.id}">Set default</button>
            <button type="button" class="btn btn-sm btn-ghost pm-delete" data-id="${m.id}">Delete</button>
          </div>
        </div>`;
    })
    .join("");

  host.querySelectorAll(".pm-default").forEach((b) => {
    b.addEventListener("click", async () => {
      const id = Number(b.dataset.id);
      const r = await request(`/api/profile/payment-methods/${id}/default`, { method: "POST", body: "{}" });
      if (!r.ok) return setStatus("paymentStatus", r.data?.error || "Failed to set default payment method");
      setStatus("paymentStatus", "Default payment method updated.");
      await afterMutation?.();
    });
  });
  host.querySelectorAll(".pm-delete").forEach((b) => {
    b.addEventListener("click", async () => {
      const id = Number(b.dataset.id);
      const r = await request(`/api/profile/payment-methods/${id}`, { method: "DELETE" });
      if (!r.ok) return setStatus("paymentStatus", r.data?.error || "Failed to delete payment method");
      setStatus("paymentStatus", "Payment method deleted.");
      await afterMutation?.();
    });
  });
}

export async function loadPrescriptionsList(afterMutation) {
  const rx = await fetch("/api/prescriptions", { credentials: "same-origin" });
  const rxData = await rx.json().catch(() => ({}));
  if (rx.ok) {
    setStatus("rxStatus", "");
    renderPrescriptions(rxData.prescriptions || [], afterMutation);
  } else {
    setStatus("rxStatus", rxData.error || "Could not load prescriptions");
    renderPrescriptions([], afterMutation);
  }
}

export function renderPrescriptions(list, afterMutation) {
  const host = $("rxList");
  if (!host) return;
  if (!list?.length) {
    host.innerHTML = `<p class="muted">No prescriptions saved yet. Upload a photo or PDF — it will appear at checkout and on future orders.</p>`;
    return;
  }
  host.innerHTML = list
    .map(
      (p) => `
      <div class="rx-match">
        <div>
          <div class="rx-match-title">#${escapeHtml(String(p.id))} · ${escapeHtml(p.original_filename || p.mime_type || "file")}</div>
          <div class="rx-match-sub muted">${escapeHtml(fmtTs(p.created_at))} · ${escapeHtml(p.source || "web")}</div>
        </div>
        <div class="auth-actions">
          <a class="btn btn-sm btn-ghost" href="/api/prescriptions/${encodeURIComponent(p.id)}/file" target="_blank" rel="noopener">View</a>
          <button type="button" class="btn btn-sm btn-ghost rx-delete" data-id="${escapeHtml(String(p.id))}">Delete</button>
        </div>
      </div>`,
    )
    .join("");
  host.querySelectorAll(".rx-delete").forEach((b) => {
    b.addEventListener("click", async () => {
      const id = Number(b.dataset.id);
      const del = await fetch(`/api/prescriptions/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "same-origin" });
      const j = await del.json().catch(() => ({}));
      if (!del.ok) {
        setStatus("rxStatus", j.error || "Could not delete");
        return;
      }
      setStatus("rxStatus", "Deleted.");
      await afterMutation?.();
    });
  });
}
