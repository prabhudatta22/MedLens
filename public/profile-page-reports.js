import { escapeHtml, fmtTs } from "./profileSectionCore.js";

function fmtInr(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "—";
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function setDiagStatus(statusEl, msg) {
  if (statusEl) statusEl.textContent = msg || "";
}

/**
 * @param {unknown} list
 * @param {HTMLElement} host
 * @param {HTMLElement | null} statusEl
 * @param {{ profileHint?: { id?: unknown; phone_e164?: unknown } | null; listError?: string | null }} opts
 */
function render(list, host, statusEl, opts = {}) {
  if (!host) return;

  const listError = opts.listError ?? null;

  const back = encodeURIComponent("/profile.html?view=reports");

  if (listError) {
    host.innerHTML =
      `<p class="muted">${escapeHtml(listError)}</p>` +
      `<p class="muted" style="margin-top: 0.65rem; font-size: 0.88rem">` +
      `<a href="/orders.html">Orders</a> · ` +
      `<a href="/login.html?returnTo=${back}">Login</a></p>`;
    return;
  }

  const rows = Array.isArray(list) ? list : [];

  if (!rows.length) {
    host.innerHTML =
      `<p class="muted">No diagnostic reports are stored for this account on this database.</p>` +
      `<p class="muted" style="margin-top: 0.65rem; font-size: 0.88rem">` +
      `If you expected a PDF, the running server may be using a different database than the one where the file was saved, or migrations have not been applied. ` +
      `You can also sign out and log in with the same method you used when the report was attached.` +
      `</p>` +
      `<p class="muted" style="margin-top: 0.5rem">` +
      `<a href="/orders.html">Orders</a> · <a href="/login.html?returnTo=${back}">Switch account</a>` +
      `</p>`;
    return;
  }

  host.innerHTML = `
    <div class="table-wrap">
      <table class="price-table" aria-label="Diagnostic reports">
        <thead>
          <tr>
            <th scope="col">Type of diagnostic</th>
            <th scope="col">Report link</th>
            <th scope="col">Money involved</th>
            <th scope="col">Booked on date</th>
            <th scope="col">Payment made by</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map((row) => {
              const id = Number(row.id);
              const isS3 =
                typeof row.storage_backend === "string" &&
                row.storage_backend.toLowerCase() === "s3";
              const safeId = Number.isFinite(id) && id >= 1 ? id : NaN;
              const linkLabel = escapeHtml(row.original_filename || "Open report");
              const orderBit = row.order_id
                ? `<div class="muted" style="font-size: 0.8rem; margin-top: 0.35rem">Order #${escapeHtml(
                    String(row.order_id),
                  )}</div>`
                : "";
              const uploadedBit = row.uploaded_at
                ? `<div class="muted" style="font-size: 0.8rem">Uploaded ${escapeHtml(fmtTs(row.uploaded_at))}</div>`
                : "";

              const reportCell = !Number.isFinite(safeId)
                ? `<span class="muted">—</span>`
                : isS3
                  ? `<a href="#" class="diag-report-s3" data-id="${safeId}">${linkLabel}</a>` +
                    `<div class="muted" style="font-size: 0.75rem; margin-top: 0.35rem">Opens a time-limited signed link</div>` +
                    uploadedBit
                  : `<a href="/api/diagnostic-reports/${safeId}/file" target="_blank" rel="noopener noreferrer">${linkLabel}</a>` +
                    uploadedBit;

              return `
          <tr>
            <td>${escapeHtml(row.diagnostic_type || "Diagnostics")}${orderBit}</td>
            <td>${reportCell}</td>
            <td class="price-cell">${escapeHtml(fmtInr(row.amount_inr))}</td>
            <td>${escapeHtml(fmtTs(row.booked_at))}</td>
            <td>${escapeHtml(row.payment_made_by || "—")}</td>
          </tr>`;
            })
            .join("")}
        </tbody>
      </table>
    </div>`;

  host.querySelectorAll(".diag-report-s3").forEach((el) => {
    el.addEventListener("click", async (ev) => {
      ev.preventDefault();
      const id = Number(el.getAttribute("data-id"));
      if (!Number.isFinite(id) || id < 1) return;
      setDiagStatus(statusEl, "");
      try {
        const r = await fetch(`/api/diagnostic-reports/${id}/download-url`, {
          credentials: "include",
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
          setDiagStatus(statusEl, data.error || "Could not prepare download.");
          return;
        }
        const url = /^https?:\/\//i.test(data.url)
          ? data.url
          : `${window.location.origin}${data.url.startsWith("/") ? data.url : `/${data.url}`}`;
        window.open(url, "_blank", "noopener,noreferrer");
      } catch (e) {
        setDiagStatus(statusEl, e?.message || "Download failed.");
      }
    });
  });
}

/**
 * @param {{
 *   wrap: HTMLElement | null | undefined;
 *   status: HTMLElement | null | undefined;
 *   seedReports?: unknown;
 *   profileReportsLoadError?: string | null;
 *   profileHint?: { id?: unknown; phone_e164?: unknown } | null;
 * }} els
 */
export async function loadDiagnosticReportsInto({
  wrap,
  status,
  seedReports,
  profileReportsLoadError = null,
  profileHint = null,
} = {}) {
  const host = wrap;
  const statusEl = status;
  if (!host || !statusEl) return;

  const seedArr = Array.isArray(seedReports) ? seedReports : [];
  const hadNonemptySeed = seedArr.length > 0;
  const profileErr =
    typeof profileReportsLoadError === "string" && profileReportsLoadError.trim()
      ? profileReportsLoadError.trim()
      : null;

  if (hadNonemptySeed) {
    render(seedArr, host, statusEl, { profileHint });
    setDiagStatus(statusEl, "");
  } else if (profileErr) {
    render([], host, statusEl, { profileHint, listError: profileErr });
    setDiagStatus(statusEl, "");
  } else {
    setDiagStatus(statusEl, "Loading reports…");
  }

  try {
    const r = await fetch("/api/diagnostic-reports", { credentials: "include" });
    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
      const detail = data.error || `Could not load reports (${r.status}).`;
      if (hadNonemptySeed) {
        setDiagStatus(statusEl, `Could not refresh list: ${detail}`);
      } else {
        setDiagStatus(statusEl, detail);
        render([], host, statusEl, { profileHint, listError: detail });
      }
      return;
    }

    setDiagStatus(statusEl, "");
    render(data.reports || [], host, statusEl, { profileHint });
  } catch (e) {
    const detail = e?.message || "Could not load reports.";
    if (hadNonemptySeed) {
      setDiagStatus(statusEl, `Could not refresh list: ${detail}`);
    } else {
      setDiagStatus(statusEl, detail);
      render([], host, statusEl, { profileHint, listError: detail });
    }
  }
}
