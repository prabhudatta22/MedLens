import { Router } from "express";
import { pool } from "../db/pool.js";
import { requireUser } from "../auth/middleware.js";

const router = Router();
router.use(requireUser);

router.get("/", async (req, res) => {
  const userId = req.user.id;
  const { rows } = await pool.query(
    `SELECT
       pr.id,
       pr.medicine_id,
       pr.medicine_label,
       pr.remind_at,
       pr.repeat_interval_days,
       pr.notes,
       pr.created_at,
       m.display_name AS catalog_name,
       m.strength AS catalog_strength
     FROM purchase_reminders pr
     LEFT JOIN medicines m ON m.id = pr.medicine_id
     WHERE pr.user_id = $1
     ORDER BY pr.remind_at ASC`,
    [userId]
  );
  res.json({ reminders: rows });
});

router.post("/", async (req, res) => {
  const userId = req.user.id;
  const medicineLabel = String(req.body?.medicine_label || "").trim();
  if (!medicineLabel || medicineLabel.length > 200) {
    return res.status(400).json({ error: "medicine_label is required (max 200 chars)" });
  }

  const medicineIdRaw = req.body?.medicine_id;
  const medicineId =
    medicineIdRaw === undefined || medicineIdRaw === null || medicineIdRaw === ""
      ? null
      : Number(medicineIdRaw);
  if (medicineId != null && (!Number.isFinite(medicineId) || medicineId < 1)) {
    return res.status(400).json({ error: "Invalid medicine_id" });
  }

  const remindAt = req.body?.remind_at ? new Date(String(req.body.remind_at)) : null;
  if (!remindAt || Number.isNaN(remindAt.getTime())) {
    return res.status(400).json({ error: "remind_at must be a valid date/time (ISO)" });
  }

  let repeat = req.body?.repeat_interval_days;
  if (repeat === undefined || repeat === null || repeat === "") repeat = null;
  else {
    repeat = Number(repeat);
    if (!Number.isFinite(repeat) || repeat < 1 || repeat > 730) {
      return res.status(400).json({ error: "repeat_interval_days must be 1–730 or omitted" });
    }
  }

  const notes = req.body?.notes != null ? String(req.body.notes).trim().slice(0, 500) : null;

  const { rows } = await pool.query(
    `INSERT INTO purchase_reminders (user_id, medicine_id, medicine_label, remind_at, repeat_interval_days, notes)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, medicine_id, medicine_label, remind_at, repeat_interval_days, notes, created_at`,
    [userId, medicineId, medicineLabel, remindAt.toISOString(), repeat, notes]
  );
  res.status(201).json({ reminder: rows[0] });
});

router.patch("/:id", async (req, res) => {
  const userId = req.user.id;
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id < 1) return res.status(400).json({ error: "Invalid id" });

  const fields = [];
  const vals = [];

  if (req.body.medicine_label != null) {
    const v = String(req.body.medicine_label).trim();
    if (!v || v.length > 200) return res.status(400).json({ error: "Invalid medicine_label" });
    vals.push(v);
    fields.push(`medicine_label = $${vals.length}`);
  }
  if (req.body.remind_at != null) {
    const d = new Date(String(req.body.remind_at));
    if (Number.isNaN(d.getTime())) return res.status(400).json({ error: "Invalid remind_at" });
    vals.push(d.toISOString());
    fields.push(`remind_at = $${vals.length}`);
  }
  if (req.body.repeat_interval_days !== undefined) {
    const r = req.body.repeat_interval_days;
    if (r === null || r === "") {
      fields.push(`repeat_interval_days = NULL`);
    } else {
      const x = Number(r);
      if (!Number.isFinite(x) || x < 1 || x > 730) {
        return res.status(400).json({ error: "repeat_interval_days must be 1–730 or null" });
      }
      vals.push(x);
      fields.push(`repeat_interval_days = $${vals.length}`);
    }
  }
  if (req.body.notes !== undefined) {
    const notes = req.body.notes == null ? null : String(req.body.notes).trim().slice(0, 500);
    vals.push(notes);
    fields.push(`notes = $${vals.length}`);
  }
  if (req.body.medicine_id !== undefined) {
    const mid = req.body.medicine_id;
    if (mid === null || mid === "") {
      fields.push(`medicine_id = NULL`);
    } else {
      const x = Number(mid);
      if (!Number.isFinite(x) || x < 1) return res.status(400).json({ error: "Invalid medicine_id" });
      vals.push(x);
      fields.push(`medicine_id = $${vals.length}`);
    }
  }

  if (!fields.length) return res.status(400).json({ error: "No fields to update" });

  fields.push(`updated_at = now()`);
  vals.push(id, userId);

  const q = `
    UPDATE purchase_reminders
    SET ${fields.join(", ")}
    WHERE id = $${vals.length - 1} AND user_id = $${vals.length}
    RETURNING id, medicine_id, medicine_label, remind_at, repeat_interval_days, notes, updated_at`;
  const { rows } = await pool.query(q, vals);
  if (!rows.length) return res.status(404).json({ error: "Not found" });
  res.json({ reminder: rows[0] });
});

router.delete("/:id", async (req, res) => {
  const userId = req.user.id;
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id < 1) return res.status(400).json({ error: "Invalid id" });

  const { rowCount } = await pool.query(
    `DELETE FROM purchase_reminders WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  if (!rowCount) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
});

/** Advance reminder by repeat_interval_days (or 30 if unset) — e.g. after user bought medicine */
router.post("/:id/bought", async (req, res) => {
  const userId = req.user.id;
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id < 1) return res.status(400).json({ error: "Invalid id" });

  const { rows } = await pool.query(
    `SELECT id, repeat_interval_days FROM purchase_reminders WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  if (!rows.length) return res.status(404).json({ error: "Not found" });

  const days = rows[0].repeat_interval_days != null ? Number(rows[0].repeat_interval_days) : 30;
  const { rows: out } = await pool.query(
    `UPDATE purchase_reminders
     SET remind_at = now() + ($1::integer * interval '1 day'),
         updated_at = now()
     WHERE id = $2 AND user_id = $3
     RETURNING id, remind_at, repeat_interval_days`,
    [Math.floor(days), id, userId]
  );
  res.json({ reminder: out[0] });
});

export default router;
