import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { pool } from "../db/pool.js";
import { ensureUserPrescriptionsSchema } from "./schema.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const UPLOAD_ROOT = join(__dirname, "..", "..", "uploads", "prescriptions");

const EXT_BY_MIME = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "application/pdf": ".pdf",
};

export function allowedPrescriptionMime(mime) {
  const m = String(mime || "").toLowerCase().split(";")[0].trim();
  return Object.prototype.hasOwnProperty.call(EXT_BY_MIME, m) ? m : null;
}

function extForMime(mime) {
  return EXT_BY_MIME[mime] || ".bin";
}

export function absPathForStorageKey(storageKey) {
  const key = String(storageKey || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!key || key.includes("..")) throw new Error("Invalid storage key");
  return join(UPLOAD_ROOT, key);
}

/**
 * @returns {{ id: number, storage_key: string }}
 */
export async function savePrescriptionForUser({
  userId,
  buffer,
  mimeType,
  originalFilename = null,
  source = "web",
  ocrPreview = null,
}) {
  await ensureUserPrescriptionsSchema();
  const uid = Number(userId);
  if (!Number.isFinite(uid) || uid < 1) throw new Error("Invalid user id");
  const mime = allowedPrescriptionMime(mimeType);
  if (!mime) throw new Error("Unsupported file type (use JPEG, PNG, WebP, or PDF)");
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (!buf.length) throw new Error("Empty file");
  if (buf.length > 10 * 1024 * 1024) throw new Error("File too large (max 10 MB)");

  const ext = extForMime(mime);
  const fileName = `${randomUUID()}${ext}`;
  const storageKey = `${uid}/${fileName}`;
  const dir = join(UPLOAD_ROOT, String(uid));
  await mkdir(dir, { recursive: true });
  const abs = join(dir, fileName);
  await writeFile(abs, buf);

  const preview =
    ocrPreview != null ? String(ocrPreview).trim().slice(0, 500) : null;
  const orig = originalFilename ? String(originalFilename).trim().slice(0, 200) : null;

  const { rows } = await pool.query(
    `INSERT INTO user_prescriptions (user_id, storage_key, original_filename, mime_type, byte_size, source, ocr_preview)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id, storage_key`,
    [uid, storageKey, orig, mime, buf.length, source === "whatsapp" ? "whatsapp" : "web", preview]
  );
  return { id: rows[0].id, storage_key: rows[0].storage_key };
}

export async function readPrescriptionFileForUser(userId, prescriptionId) {
  await ensureUserPrescriptionsSchema();
  const uid = Number(userId);
  const pid = Number(prescriptionId);
  if (!Number.isFinite(uid) || !Number.isFinite(pid)) return null;
  const { rows } = await pool.query(
    `SELECT storage_key, mime_type, original_filename FROM user_prescriptions WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [pid, uid]
  );
  if (!rows.length) return null;
  const r = rows[0];
  const abs = absPathForStorageKey(r.storage_key);
  const body = await readFile(abs);
  return {
    body,
    mimeType: r.mime_type,
    filename: r.original_filename || "prescription",
  };
}

export async function deletePrescriptionForUser(userId, prescriptionId) {
  await ensureUserPrescriptionsSchema();
  const uid = Number(userId);
  const pid = Number(prescriptionId);
  if (!Number.isFinite(uid) || !Number.isFinite(pid)) return { ok: false, error: "Invalid id" };
  const { rows } = await pool.query(
    `SELECT id, storage_key FROM user_prescriptions WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [pid, uid]
  );
  if (!rows.length) return { ok: false, error: "Not found" };
  const block = await pool.query(
    `SELECT 1 FROM orders WHERE prescription_id = $1 LIMIT 1`,
    [pid]
  );
  if (block.rows.length) {
    return { ok: false, error: "This prescription is linked to an order and cannot be deleted." };
  }
  const sk = rows[0].storage_key;
  await pool.query(`DELETE FROM user_prescriptions WHERE id = $1 AND user_id = $2`, [pid, uid]);
  try {
    await unlink(absPathForStorageKey(sk));
  } catch {
    /* ignore missing file */
  }
  return { ok: true };
}
