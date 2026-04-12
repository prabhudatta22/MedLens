import { Router } from "express";
import multer from "multer";
import { pool } from "../db/pool.js";
import { requireUser } from "../auth/middleware.js";
import { ensureUserPrescriptionsSchema } from "../prescriptions/schema.js";
import {
  allowedPrescriptionMime,
  deletePrescriptionForUser,
  readPrescriptionFileForUser,
  savePrescriptionForUser,
} from "../prescriptions/store.js";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

function requireConsumer(req, res, next) {
  if (req.user?.role === "service_provider") {
    return res.status(403).json({ error: "Prescriptions are available only for consumer accounts." });
  }
  return next();
}

router.use(requireUser);
router.use(requireConsumer);

router.get("/", async (req, res) => {
  try {
    await ensureUserPrescriptionsSchema();
    const userId = req.user.id;
    const { rows } = await pool.query(
      `SELECT id, original_filename, mime_type, byte_size, source, created_at
       FROM user_prescriptions
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [userId]
    );
    res.json({ prescriptions: rows });
  } catch (e) {
    res.status(500).json({ error: e?.message || "Failed to list prescriptions" });
  }
});

router.post("/", upload.single("file"), async (req, res) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ error: "Missing file (field name: file)" });
    }
    const mime = allowedPrescriptionMime(req.file.mimetype);
    if (!mime) {
      return res.status(400).json({ error: "Unsupported type. Upload a photo (JPEG/PNG/WebP) or PDF." });
    }
    const ocrPreview = req.body?.ocr_preview ? String(req.body.ocr_preview) : null;
    const out = await savePrescriptionForUser({
      userId: req.user.id,
      buffer: req.file.buffer,
      mimeType: mime,
      originalFilename: req.file.originalname,
      source: "web",
      ocrPreview,
    });
    const { rows } = await pool.query(
      `SELECT id, original_filename, mime_type, byte_size, source, created_at
       FROM user_prescriptions WHERE id = $1 LIMIT 1`,
      [out.id]
    );
    res.status(201).json({ prescription: rows[0] });
  } catch (e) {
    res.status(400).json({ error: e?.message || "Upload failed" });
  }
});

router.get("/:id/file", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id < 1) return res.status(400).json({ error: "Invalid id" });
    const file = await readPrescriptionFileForUser(req.user.id, id);
    if (!file) return res.status(404).json({ error: "Not found" });
    res.setHeader("Content-Type", file.mimeType);
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(file.filename)}"`);
    res.send(file.body);
  } catch (e) {
    res.status(500).json({ error: e?.message || "Read failed" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id < 1) return res.status(400).json({ error: "Invalid id" });
    const out = await deletePrescriptionForUser(req.user.id, id);
    if (!out.ok) {
      const status = out.error === "Not found" ? 404 : 409;
      return res.status(status).json({ error: out.error });
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e?.message || "Delete failed" });
  }
});

export default router;
