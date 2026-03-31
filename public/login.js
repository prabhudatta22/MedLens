const $ = (id) => document.getElementById(id);

function pretty(x) {
  return JSON.stringify(x, null, 2);
}

function showVerifyStep() {
  const panel = $("verifyPanel");
  if (!panel) return;
  panel.classList.remove("is-hidden");
}

function hideVerifyStep() {
  const panel = $("verifyPanel");
  if (!panel) return;
  panel.classList.add("is-hidden");
}

function setMode(mode) {
  const provider = mode === "provider";
  $("passwordPanel")?.classList.toggle("is-hidden", !provider);
  $("requestPanel")?.classList.toggle("is-hidden", provider);
  if (provider) hideVerifyStep();

  // clear outputs when switching modes
  if ($("passOut")) $("passOut").textContent = "";
  if ($("reqOut")) $("reqOut").textContent = "";
  if ($("verOut")) $("verOut").textContent = "";
}

async function post(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
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

const modeSel = $("loginMode");
if (modeSel) {
  modeSel.addEventListener("change", () => setMode(modeSel.value));
  setMode(modeSel.value || "user");
} else {
  setMode("user");
}

$("#passwordLogin")?.addEventListener("click", async () => {
  $("#passOut").textContent = "Logging in…";
  const username = $("#username")?.value || "";
  const password = $("#password")?.value || "";
  const r = await post("/api/auth/login", { username, password });
  if (!r.ok) {
    $("#passOut").textContent = r.json?.error || `Login failed (${r.status})`;
    return;
  }
  $("#passOut").textContent = "Logged in successfully. Redirecting…";
  setTimeout(() => {
    window.location.href = "/";
  }, 450);
});

$("#request").addEventListener("click", async () => {
  $("#reqOut").textContent = "Sending…";
  hideVerifyStep();
  const phone = $("#phone").value;
  const r = await post("/api/auth/request-otp", { phone });
  $("#reqOut").textContent = pretty({ status: r.status, ...r.json });
  if (r.ok) showVerifyStep();
  if (r.json?.dev_otp) $("#code").value = r.json.dev_otp;
  if (r.ok) $("#code")?.focus?.();
});

$("#verify").addEventListener("click", async () => {
  $("#verOut").textContent = "Verifying…";
  const phone = $("#phone").value;
  const code = $("#code").value;
  const r = await post("/api/auth/verify-otp", { phone, code });
  $("#verOut").textContent = pretty({ status: r.status, ...r.json });
});

$("#logout").addEventListener("click", async () => {
  $("#verOut").textContent = "Logging out…";
  const r = await post("/api/auth/logout", {});
  $("#verOut").textContent = pretty({ status: r.status, ...r.json });
});

