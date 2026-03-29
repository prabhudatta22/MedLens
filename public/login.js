const $ = (id) => document.getElementById(id);

function pretty(x) {
  return JSON.stringify(x, null, 2);
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

$("#request").addEventListener("click", async () => {
  $("#reqOut").textContent = "Sending…";
  const phone = $("#phone").value;
  const r = await post("/api/auth/request-otp", { phone });
  $("#reqOut").textContent = pretty({ status: r.status, ...r.json });
  if (r.json?.dev_otp) $("#code").value = r.json.dev_otp;
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

