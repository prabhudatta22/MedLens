import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCAL_ROOT = join(__dirname, "..", "..", "uploads", "diagnostic-reports");

const EXT_BY_MIME = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "application/pdf": ".pdf",
};

/** @returns {number} max bytes */
export function maxDiagnosticReportBytes() {
  const n = Number(process.env.DIAGNOSTIC_REPORT_MAX_BYTES);
  return Number.isFinite(n) && n > 1024 && n <= 52428800 ? Math.floor(n) : 20971520;
}

export function allowedDiagnosticReportMime(mime) {
  const m = String(mime || "").toLowerCase().split(";")[0].trim();
  return Object.prototype.hasOwnProperty.call(EXT_BY_MIME, m) ? m : null;
}

function extForMime(mime) {
  return EXT_BY_MIME[mime] || ".bin";
}

export function useS3ForDiagnosticReports() {
  const bucket = String(process.env.DIAGNOSTIC_REPORTS_S3_BUCKET || "").trim();
  const region = String(process.env.DIAGNOSTIC_REPORTS_S3_REGION || process.env.AWS_REGION || "").trim();
  return Boolean(bucket && region);
}

function s3Bucket() {
  return String(process.env.DIAGNOSTIC_REPORTS_S3_BUCKET || "").trim();
}

function s3Prefix() {
  const p = String(process.env.DIAGNOSTIC_REPORTS_S3_PREFIX || "diag-reports").replace(/^\/+|\/+$/g, "");
  return p || "diag-reports";
}

let s3Singleton = null;

function getS3Client() {
  if (s3Singleton) return s3Singleton;
  const region = process.env.DIAGNOSTIC_REPORTS_S3_REGION || process.env.AWS_REGION;
  if (!region) return null;
  s3Singleton = new S3Client({ region });
  return s3Singleton;
}

export function localAbsPath(storageKey) {
  const key = String(storageKey || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!key || key.includes("..")) throw new Error("Invalid storage key");
  return join(LOCAL_ROOT, key);
}

/**
 * @returns {Promise<{ storage_backend: 'local'|'s3', storage_key: string, s3_bucket: string|null, byte_size: number }>}
 */
export async function persistDiagnosticReportFile({
  userId,
  buffer,
  mimeType,
  originalFilename: _originalFilename = null,
}) {
  const uid = Number(userId);
  if (!Number.isFinite(uid) || uid < 1) throw new Error("Invalid user id");
  const mime = allowedDiagnosticReportMime(mimeType);
  if (!mime) throw new Error("Unsupported file type (use JPEG, PNG, WebP, or PDF)");
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const maxB = maxDiagnosticReportBytes();
  if (!buf.length) throw new Error("Empty file");
  if (buf.length > maxB) throw new Error(`File too large (max ${maxB} bytes)`);

  const ext = extForMime(mime);
  const fileBase = `${randomUUID()}${ext}`;

  if (useS3ForDiagnosticReports()) {
    const client = getS3Client();
    if (!client) throw new Error("S3 is not configured (missing AWS region)");

    const bucket = s3Bucket();
    const key = `${s3Prefix()}/${uid}/${fileBase}`;
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buf,
        ContentType: mime,
      })
    );

    return {
      storage_backend: "s3",
      storage_key: key,
      s3_bucket: bucket,
      byte_size: buf.length,
    };
  }

  const storage_key = `${uid}/${fileBase}`;
  const dir = join(LOCAL_ROOT, String(uid));
  await mkdir(dir, { recursive: true });
  const abs = join(dir, fileBase);
  await writeFile(abs, buf);

  return {
    storage_backend: "local",
    storage_key,
    s3_bucket: null,
    byte_size: buf.length,
  };
}

export async function readLocalDiagnosticReport(storageKey) {
  const abs = localAbsPath(storageKey);
  return readFile(abs);
}

/**
 * @returns {Promise<string>}
 */
export async function signedGetUrlForDiagnosticReport({ storage_key, mime_type }) {
  if (!useS3ForDiagnosticReports()) {
    throw new Error("S3 not enabled");
  }
  const client = getS3Client();
  const bucket = s3Bucket();
  if (!client || !bucket) throw new Error("S3 not configured");

  const secondsRaw = Number(process.env.DIAGNOSTIC_REPORTS_SIGNED_URL_SECONDS);
  const expiresIn =
    Number.isFinite(secondsRaw) && secondsRaw >= 60 && secondsRaw <= 86400 ? Math.floor(secondsRaw) : 900;

  const cmd = new GetObjectCommand({
    Bucket: bucket,
    Key: storage_key,
    ResponseContentType: mime_type || undefined,
  });
  return getSignedUrl(client, cmd, { expiresIn });
}

export async function deleteDiagnosticReportBlob(row) {
  if (row.storage_backend === "s3" && row.s3_bucket && row.storage_key) {
    try {
      const client = getS3Client();
      if (client) {
        await client.send(new DeleteObjectCommand({ Bucket: row.s3_bucket, Key: row.storage_key }));
      }
    } catch {
      /* best-effort */
    }
    return;
  }
  try {
    await unlink(localAbsPath(row.storage_key));
  } catch {
    /* ignore */
  }
}
