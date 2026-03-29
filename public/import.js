const $ = (id) => document.getElementById(id);

function pretty(obj) {
  return JSON.stringify(obj, null, 2);
}

$("#form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const file = $("#file").files?.[0];
  if (!file) return;

  $("#btn").disabled = true;
  $("#out").textContent = "Importing…";

  try {
    const fd = new FormData();
    fd.append("file", file);

    const res = await fetch("/api/import/prices/xlsx", { method: "POST", body: fd });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
    $("#out").textContent = pretty({ status: res.status, ...json });
  } catch (err) {
    $("#out").textContent = String(err?.message || err);
  } finally {
    $("#btn").disabled = false;
  }
});

