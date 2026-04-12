import { cacheUser, clearCachedUser, fetchAndCacheUser, loadCachedUser } from "./authProfile.js";

const $ = (id) => document.getElementById(id);

let profileData = null;

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtTs(s) {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function fmtInr(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  return `₹${x.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

async function request(url, options = {}) {
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

function setStatus(id, msg) {
  const el = $(id);
  if (el) el.textContent = msg || "";
}

function renderNav(user) {
  const navUser = $("navUser");
  const navLogin = $("navLogin");
  const navLogout = $("navLogout");
  const navProfile = $("navProfile");
  const logged = Boolean(user);
  navLogin?.classList.toggle("hidden", logged);
  navLogout?.classList.toggle("hidden", !logged);
  // Keep header consistent with other pages: show only "Profile" link post-login.
  navUser?.classList.add("hidden");
  if (navUser) navUser.textContent = "";
  navProfile?.classList.toggle("hidden", !logged);
}

function fillBasicForm(profile) {
  $("pfName").value = profile?.full_name || "";
  $("pfGender").value = profile?.gender || "";
  $("pfPhone").value = profile?.phone_e164 || "";
  $("pfEmail").value = profile?.email || "";
  const p = $("profileNamePreview");
  if (p) p.textContent = profile?.full_name || profile?.email || profile?.phone_e164 || "User";
}

function renderAddresses(addresses) {
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
      </div>`
    )
    .join("");

  host.querySelectorAll(".addr-default").forEach((b) => {
    b.addEventListener("click", async () => {
      const id = Number(b.dataset.id);
      const r = await request(`/api/profile/addresses/${id}/default`, { method: "POST", body: "{}" });
      if (!r.ok) return setStatus("addressStatus", r.data?.error || "Failed to set default address");
      setStatus("addressStatus", "Default address updated.");
      await loadProfile();
    });
  });
  host.querySelectorAll(".addr-delete").forEach((b) => {
    b.addEventListener("click", async () => {
      const id = Number(b.dataset.id);
      const r = await request(`/api/profile/addresses/${id}`, { method: "DELETE" });
      if (!r.ok) return setStatus("addressStatus", r.data?.error || "Failed to delete address");
      setStatus("addressStatus", "Address deleted.");
      await loadProfile();
    });
  });
}

function renderPaymentMethods(methods) {
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
      await loadProfile();
    });
  });
  host.querySelectorAll(".pm-delete").forEach((b) => {
    b.addEventListener("click", async () => {
      const id = Number(b.dataset.id);
      const r = await request(`/api/profile/payment-methods/${id}`, { method: "DELETE" });
      if (!r.ok) return setStatus("paymentStatus", r.data?.error || "Failed to delete payment method");
      setStatus("paymentStatus", "Payment method deleted.");
      await loadProfile();
    });
  });
}

function renderRecentOrders(orders) {
  const tbody = $("recentOrdersRows");
  if (!tbody) return;
  if (!orders?.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="muted">No orders found.</td></tr>`;
    return;
  }
  tbody.innerHTML = orders
    .map(
      (o) => `
      <tr>
        <td><strong>#${escapeHtml(o.id)}</strong></td>
        <td>${escapeHtml(o.status)}</td>
        <td class="muted">${escapeHtml(o.delivery_option)}${o.scheduled_for ? ` · ${escapeHtml(fmtTs(o.scheduled_for))}` : ""}</td>
        <td class="price-cell">${fmtInr(o.delivery_fee_inr)}</td>
        <td class="muted">${escapeHtml(fmtTs(o.created_at))}</td>
        <td><a href="/order.html?id=${encodeURIComponent(o.id)}">Track</a></td>
      </tr>`
    )
    .join("");
}

function renderPrescriptions(list) {
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
      </div>`
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
      await loadProfile();
    });
  });
}

async function loadProfile() {
  const r = await request("/api/profile");
  if (r.status === 401) {
    clearCachedUser();
    window.location.assign("/login.html");
    return;
  }
  if (!r.ok) {
    setStatus("profileStatus", r.data?.error || "Failed to load profile");
    return;
  }
  profileData = r.data;
  fillBasicForm(r.data.profile);
  renderAddresses(r.data.addresses || []);
  renderPaymentMethods(r.data.payment_methods || []);
  renderRecentOrders(r.data.orders || []);

  const rx = await fetch("/api/prescriptions", { credentials: "same-origin" });
  const rxData = await rx.json().catch(() => ({}));
  if (rx.ok) renderPrescriptions(rxData.prescriptions || []);
  else renderPrescriptions([]);

  if (r.data?.profile) {
    cacheUser({
      ...(loadCachedUser() || {}),
      ...r.data.profile,
      role: "user",
    });
    renderNav(loadCachedUser());
  }
}

async function saveBasicProfile(e) {
  e.preventDefault();
  const payload = {
    full_name: $("pfName").value.trim(),
    gender: $("pfGender").value,
    email: $("pfEmail").value.trim(),
  };
  const r = await request("/api/profile/basic", { method: "PUT", body: JSON.stringify(payload) });
  if (!r.ok) {
    setStatus("profileStatus", r.data?.error || "Failed to save profile");
    return;
  }
  setStatus("profileStatus", "Profile updated.");
  await loadProfile();
}

async function saveManualAddress(e) {
  e.preventDefault();
  const payload = {
    label: $("addrLabel").value.trim(),
    name: $("pfName").value.trim(),
    address_line1: $("addrLine1").value.trim(),
    landmark: $("addrLandmark").value.trim(),
    city: $("addrCity").value.trim(),
    state: $("addrState").value.trim(),
    pincode: $("addrPin").value.trim(),
    is_default: !(profileData?.addresses || []).length,
  };
  const r = await request("/api/profile/addresses", { method: "POST", body: JSON.stringify(payload) });
  if (!r.ok) {
    setStatus("addressStatus", r.data?.error || "Failed to save address");
    return;
  }
  setStatus("addressStatus", "Address saved.");
  $("addressForm")?.reset();
  await loadProfile();
}

async function saveCurrentLocationAddress() {
  const hintEl = $("addressStatus");
  if (!navigator.geolocation) {
    setStatus("addressStatus", "Geolocation is not supported in this browser.");
    return;
  }
  setStatus("addressStatus", "Reading current location…");
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      try {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const geo = await request(`/api/geocode/reverse?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`, {
          method: "GET",
        });
        if (!geo.ok || !geo.data?.google) {
          setStatus("addressStatus", geo.data?.error || "Could not resolve address from location.");
          return;
        }
        const g = geo.data.google;
        const payload = {
          label: "Current location",
          name: $("pfName").value.trim(),
          address_line1: g.formatted_address || `${lat}, ${lng}`,
          city: g.locality || g.administrative_area_level_2 || "",
          state: g.administrative_area_level_1 || "",
          pincode: g.postal_code || "",
          lat,
          lng,
          is_default: true,
        };
        const save = await request("/api/profile/addresses", { method: "POST", body: JSON.stringify(payload) });
        if (!save.ok) {
          setStatus("addressStatus", save.data?.error || "Failed to save current location address");
          return;
        }
        setStatus("addressStatus", "Current location saved as default address.");
        await loadProfile();
      } catch (err) {
        setStatus("addressStatus", String(err?.message || err));
      }
    },
    (err) => {
      if (!hintEl) return;
      hintEl.textContent =
        err.code === 1
          ? "Location blocked. Allow location for this site and try again."
          : `Location unavailable (${err.message || err.code}).`;
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 300000 }
  );
}

async function saveUpi(e) {
  e.preventDefault();
  const payload = {
    method_type: "upi",
    upi_id: $("upiId").value.trim(),
    label: $("upiLabel").value.trim(),
    is_default: !(profileData?.payment_methods || []).length,
  };
  const r = await request("/api/profile/payment-methods", { method: "POST", body: JSON.stringify(payload) });
  if (!r.ok) return setStatus("paymentStatus", r.data?.error || "Failed to save UPI method");
  setStatus("paymentStatus", "UPI method saved.");
  $("upiForm")?.reset();
  await loadProfile();
}

async function saveCard(e) {
  e.preventDefault();
  const payload = {
    method_type: "card",
    card_last4: $("cardLast4").value.trim(),
    card_network: $("cardNetwork").value.trim(),
    card_holder_name: $("cardHolder").value.trim(),
    label: $("cardLabel").value.trim(),
    is_default: !(profileData?.payment_methods || []).length,
  };
  const r = await request("/api/profile/payment-methods", { method: "POST", body: JSON.stringify(payload) });
  if (!r.ok) return setStatus("paymentStatus", r.data?.error || "Failed to save card method");
  setStatus("paymentStatus", "Card method saved.");
  $("cardForm")?.reset();
  await loadProfile();
}

async function init() {
  renderNav(loadCachedUser());
  const fresh = await fetchAndCacheUser();
  renderNav(fresh);

  $("basicProfileForm")?.addEventListener("submit", saveBasicProfile);
  $("rxProfileUpload")?.addEventListener("change", async (ev) => {
    const f = ev.target?.files?.[0];
    if (!f) return;
    setStatus("rxStatus", "Uploading…");
    const fd = new FormData();
    fd.append("file", f);
    const res = await fetch("/api/prescriptions", { method: "POST", body: fd, credentials: "same-origin" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStatus("rxStatus", data.error || "Upload failed");
      return;
    }
    ev.target.value = "";
    setStatus("rxStatus", "Saved.");
    await loadProfile();
  });
  $("addressForm")?.addEventListener("submit", saveManualAddress);
  $("useLocationAddressBtn")?.addEventListener("click", saveCurrentLocationAddress);
  $("upiForm")?.addEventListener("submit", saveUpi);
  $("cardForm")?.addEventListener("submit", saveCard);
  $("navLogout")?.addEventListener("click", async (e) => {
    e.preventDefault();
    await request("/api/auth/logout", { method: "POST", body: "{}" });
    clearCachedUser();
    window.location.assign("/login.html");
  });

  await loadProfile();
}

init().catch((e) => setStatus("profileStatus", String(e?.message || e)));

