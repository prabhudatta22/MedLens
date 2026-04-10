import { Router } from "express";
import { pool } from "../db/pool.js";
import { requireUser } from "../auth/middleware.js";
import { sendTextMessage, isWhatsappConfigured } from "../integrations/whatsappCloud.js";

const router = Router();
router.use(requireUser);
let ordersSchemaReadyPromise = null;

async function ensureOrdersSchema() {
  if (ordersSchemaReadyPromise) return ordersSchemaReadyPromise;
  ordersSchemaReadyPromise = (async () => {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS user_addresses (
         id SERIAL PRIMARY KEY,
         user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
         label TEXT,
         name TEXT,
         phone_e164 TEXT,
         address_line1 TEXT NOT NULL,
         address_line2 TEXT,
         landmark TEXT,
         city TEXT,
         state TEXT,
         pincode TEXT,
         lat DOUBLE PRECISION,
         lng DOUBLE PRECISION,
         created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
         updated_at TIMESTAMPTZ,
         is_default BOOLEAN NOT NULL DEFAULT false
       );

       CREATE INDEX IF NOT EXISTS idx_user_addresses_user ON user_addresses (user_id, created_at DESC);

       CREATE TABLE IF NOT EXISTS orders (
         id SERIAL PRIMARY KEY,
         user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
         status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created','confirmed','packed','out_for_delivery','delivered','cancelled')),
         delivery_option TEXT NOT NULL DEFAULT 'normal' CHECK (delivery_option IN ('express_60','express_4_6','same_day','normal')),
         delivery_fee_inr NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (delivery_fee_inr >= 0),
         scheduled_for TIMESTAMPTZ,
         address_id INTEGER REFERENCES user_addresses (id) ON DELETE SET NULL,
         notes TEXT,
         created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
         updated_at TIMESTAMPTZ
       );

       CREATE INDEX IF NOT EXISTS idx_orders_user_created ON orders (user_id, created_at DESC);
       CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status, created_at DESC);

       CREATE TABLE IF NOT EXISTS order_items (
         id SERIAL PRIMARY KEY,
         order_id INTEGER NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
         source TEXT NOT NULL DEFAULT 'local' CHECK (source IN ('local','online','catalog')),
         pharmacy_id INTEGER REFERENCES pharmacies (id) ON DELETE SET NULL,
         medicine_id INTEGER REFERENCES medicines (id) ON DELETE SET NULL,
         item_label TEXT NOT NULL,
         strength TEXT,
         form TEXT,
         pack_size INTEGER,
         quantity_units INTEGER NOT NULL DEFAULT 1 CHECK (quantity_units >= 1),
         tablets_per_day NUMERIC(8, 2),
         unit_price_inr NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (unit_price_inr >= 0),
         mrp_inr NUMERIC(12, 2),
         created_at TIMESTAMPTZ NOT NULL DEFAULT now()
       );

       CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items (order_id);

       CREATE TABLE IF NOT EXISTS order_events (
         id SERIAL PRIMARY KEY,
         order_id INTEGER NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
         status TEXT NOT NULL,
         message TEXT,
         created_at TIMESTAMPTZ NOT NULL DEFAULT now()
       );

       CREATE INDEX IF NOT EXISTS idx_order_events_order ON order_events (order_id, created_at ASC);

       ALTER TABLE purchase_reminders
         ADD COLUMN IF NOT EXISTS order_id INTEGER REFERENCES orders (id) ON DELETE SET NULL;`
    );
  })().catch((e) => {
    ordersSchemaReadyPromise = null;
    throw e;
  });
  return ordersSchemaReadyPromise;
}

function nowPlusMinutes(min) {
  return new Date(Date.now() + min * 60_000);
}

function quoteDelivery(delivery_option) {
  const opt = String(delivery_option || "normal");
  switch (opt) {
    case "express_60":
      return { delivery_option: opt, fee_inr: 49, scheduled_for: nowPlusMinutes(60) };
    case "express_4_6":
      return { delivery_option: opt, fee_inr: 29, scheduled_for: nowPlusMinutes(5 * 60) };
    case "same_day":
      return { delivery_option: opt, fee_inr: 19, scheduled_for: nowPlusMinutes(8 * 60) };
    case "normal":
    default:
      return { delivery_option: "normal", fee_inr: 0, scheduled_for: nowPlusMinutes(24 * 60) };
  }
}

function toWaIdFromE164(phone_e164) {
  const d = String(phone_e164 || "").replace(/[^\d]/g, "");
  return d || null;
}

async function maybeNotifyWhatsapp({ userPhoneE164, text }) {
  if (!isWhatsappConfigured()) return;
  const wa = toWaIdFromE164(userPhoneE164);
  if (!wa) return;
  await sendTextMessage({ toWaId: wa, text }).catch(() => {});
}

router.post("/", async (req, res) => {
  await ensureOrdersSchema();
  const userId = req.user.id;
  const role = req.user.role;
  if (role === "service_provider") return res.status(403).json({ error: "Service provider cannot place consumer orders" });

  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!items.length) return res.status(400).json({ error: "items[] is required" });

  // MVP: only allow local items for home delivery
  const nonLocal = items.find((i) => String(i.source || "local") !== "local");
  if (nonLocal) {
    return res.status(400).json({ error: "Only local pharmacy items can be ordered for delivery (for now)." });
  }

  const addr = req.body?.address || {};
  const address_line1 = String(addr.address_line1 || "").trim().slice(0, 200);
  if (!address_line1) return res.status(400).json({ error: "address.address_line1 is required" });

  const delivery_option = String(req.body?.delivery_option || "normal");
  const q = quoteDelivery(delivery_option);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const addrRes = await client.query(
      `INSERT INTO user_addresses (user_id, label, name, phone_e164, address_line1, address_line2, landmark, city, state, pincode, lat, lng, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now())
       RETURNING id`,
      [
        userId,
        addr.label ? String(addr.label).trim().slice(0, 60) : null,
        addr.name ? String(addr.name).trim().slice(0, 80) : null,
        addr.phone_e164 ? String(addr.phone_e164).trim().slice(0, 30) : req.user.phone_e164 || null,
        address_line1,
        addr.address_line2 ? String(addr.address_line2).trim().slice(0, 200) : null,
        addr.landmark ? String(addr.landmark).trim().slice(0, 120) : null,
        addr.city ? String(addr.city).trim().slice(0, 80) : null,
        addr.state ? String(addr.state).trim().slice(0, 80) : null,
        addr.pincode ? String(addr.pincode).trim().slice(0, 12) : null,
        addr.lat != null ? Number(addr.lat) : null,
        addr.lng != null ? Number(addr.lng) : null,
      ]
    );

    const orderRes = await client.query(
      `INSERT INTO orders (user_id, status, delivery_option, delivery_fee_inr, scheduled_for, address_id, notes, updated_at)
       VALUES ($1,'created',$2,$3,$4,$5,$6, now())
       RETURNING id, status, delivery_option, delivery_fee_inr, scheduled_for, created_at`,
      [
        userId,
        q.delivery_option,
        q.fee_inr,
        q.scheduled_for.toISOString(),
        addrRes.rows[0].id,
        req.body?.notes ? String(req.body.notes).trim().slice(0, 500) : null,
      ]
    );
    const order = orderRes.rows[0];

    await client.query(
      `INSERT INTO order_events (order_id, status, message)
       VALUES ($1,$2,$3)`,
      [order.id, "created", "Order created"]
    );

    for (const it of items) {
      const pharmacy_id = Number(it.pharmacyId);
      const medicine_id = Number(it.medicineId);
      const quantity_units = Math.max(1, Math.floor(Number(it.quantity || it.quantity_units || 1)));
      const tablets_per_day =
        it.tablets_per_day == null || it.tablets_per_day === ""
          ? null
          : Number(it.tablets_per_day);

      if (!Number.isFinite(pharmacy_id) || pharmacy_id < 1) throw new Error("Invalid pharmacyId in items[]");
      if (!Number.isFinite(medicine_id) || medicine_id < 1) throw new Error("Invalid medicineId in items[]");

      const item_label = String(it.medicineLabel || it.item_label || "").trim().slice(0, 200);
      if (!item_label) throw new Error("item_label/medicineLabel required");

      await client.query(
        `INSERT INTO order_items
           (order_id, source, pharmacy_id, medicine_id, item_label, strength, form, pack_size, quantity_units, tablets_per_day, unit_price_inr, mrp_inr)
         VALUES
           ($1,'local',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          order.id,
          pharmacy_id,
          medicine_id,
          item_label,
          it.strength ? String(it.strength).trim().slice(0, 80) : null,
          it.form ? String(it.form).trim().slice(0, 40) : null,
          it.pack_size != null ? Number(it.pack_size) : null,
          quantity_units,
          tablets_per_day,
          Number(it.unitPriceInr || it.unit_price_inr || 0) || 0,
          it.mrpInr != null ? Number(it.mrpInr) : it.mrp_inr != null ? Number(it.mrp_inr) : null,
        ]
      );
    }

    await client.query("COMMIT");

    // WhatsApp: push initial status
    await maybeNotifyWhatsapp({
      userPhoneE164: req.user.phone_e164,
      text: `MedLens: Order #${order.id} placed. Status: ${order.status}. Delivery option: ${order.delivery_option}.`,
    });

    res.status(201).json({ ok: true, order });
  } catch (e) {
    await client.query("ROLLBACK");
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    client.release();
  }
});

router.get("/", async (req, res) => {
  await ensureOrdersSchema();
  const userId = req.user.id;
  const { rows } = await pool.query(
    `SELECT id, status, delivery_option, delivery_fee_inr, scheduled_for, created_at, updated_at
     FROM orders
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 10`,
    [userId]
  );
  res.json({ orders: rows });
});

router.get("/:id", async (req, res) => {
  await ensureOrdersSchema();
  const userId = req.user.id;
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id < 1) return res.status(400).json({ error: "Invalid id" });

  const orderRes = await pool.query(
    `SELECT o.*, a.address_line1, a.address_line2, a.landmark, a.city, a.state, a.pincode
     FROM orders o
     LEFT JOIN user_addresses a ON a.id = o.address_id
     WHERE o.id = $1 AND o.user_id = $2
     LIMIT 1`,
    [id, userId]
  );
  if (!orderRes.rows.length) return res.status(404).json({ error: "Not found" });

  const itemsRes = await pool.query(
    `SELECT oi.*, p.name AS pharmacy_name
     FROM order_items oi
     LEFT JOIN pharmacies p ON p.id = oi.pharmacy_id
     WHERE oi.order_id = $1
     ORDER BY oi.id ASC`,
    [id]
  );

  const eventsRes = await pool.query(
    `SELECT id, status, message, created_at
     FROM order_events
     WHERE order_id = $1
     ORDER BY created_at ASC`,
    [id]
  );

  res.json({ order: orderRes.rows[0], items: itemsRes.rows, events: eventsRes.rows });
});

// MVP: user can cancel only if not yet out_for_delivery/delivered
router.post("/:id/cancel", async (req, res) => {
  await ensureOrdersSchema();
  const userId = req.user.id;
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id < 1) return res.status(400).json({ error: "Invalid id" });

  const { rows } = await pool.query(
    `SELECT id, status FROM orders WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [id, userId]
  );
  if (!rows.length) return res.status(404).json({ error: "Not found" });
  const st = rows[0].status;
  if (["out_for_delivery", "delivered", "cancelled"].includes(st)) {
    return res.status(400).json({ error: `Cannot cancel order in status ${st}` });
  }

  await pool.query(`UPDATE orders SET status = 'cancelled', updated_at = now() WHERE id = $1 AND user_id = $2`, [
    id,
    userId,
  ]);
  await pool.query(`INSERT INTO order_events (order_id, status, message) VALUES ($1,'cancelled',$2)`, [
    id,
    "Cancelled by user",
  ]);

  await maybeNotifyWhatsapp({
    userPhoneE164: req.user.phone_e164,
    text: `MedLens: Order #${id} cancelled.`,
  });

  res.json({ ok: true });
});

// Internal helper: create reminders for order items (called when order delivered)
async function createRefillRemindersFromOrder({ orderId, userId }) {
  const { rows: items } = await pool.query(
    `SELECT id, medicine_id, item_label, quantity_units, pack_size, tablets_per_day
     FROM order_items
     WHERE order_id = $1`,
    [orderId]
  );
  for (const it of items) {
    const perDay = it.tablets_per_day != null ? Number(it.tablets_per_day) : null;
    const pack = it.pack_size != null ? Number(it.pack_size) : null;
    const qtyUnits = Number(it.quantity_units) || 1;
    if (!perDay || !Number.isFinite(perDay) || perDay <= 0) continue;
    if (!pack || !Number.isFinite(pack) || pack <= 0) continue;

    const totalTabs = qtyUnits * pack;
    const daysSupply = totalTabs / perDay;
    if (!Number.isFinite(daysSupply) || daysSupply <= 0.5) continue;

    const bufferDays = 3;
    const remindInDays = Math.max(1, Math.floor(daysSupply - bufferDays));
    const remindAt = new Date(Date.now() + remindInDays * 24 * 60 * 60_000).toISOString();

    await pool.query(
      `INSERT INTO purchase_reminders (user_id, medicine_id, medicine_label, remind_at, repeat_interval_days, notes, order_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT DO NOTHING`,
      [
        userId,
        it.medicine_id || null,
        String(it.item_label).slice(0, 200),
        remindAt,
        Math.max(1, Math.floor(daysSupply)),
        `Auto reminder from order #${orderId} (${totalTabs} tablets @ ${perDay}/day)`,
        orderId,
      ]
    );
  }
}

// MVP: allow service_provider to update status for now (in real life: scoped to their pharmacy)
router.post("/:id/events", async (req, res) => {
  await ensureOrdersSchema();
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id < 1) return res.status(400).json({ error: "Invalid id" });

  const status = String(req.body?.status || "").trim();
  const message = req.body?.message != null ? String(req.body.message).trim().slice(0, 300) : null;
  const allowed = ["confirmed", "packed", "out_for_delivery", "delivered", "cancelled"];
  if (!allowed.includes(status)) return res.status(400).json({ error: `Invalid status. Allowed: ${allowed.join(", ")}` });

  // Find order + owner
  const { rows } = await pool.query(`SELECT id, user_id, status AS current_status FROM orders WHERE id = $1 LIMIT 1`, [
    id,
  ]);
  if (!rows.length) return res.status(404).json({ error: "Not found" });
  const ord = rows[0];

  await pool.query(`UPDATE orders SET status = $1, updated_at = now() WHERE id = $2`, [status, id]);
  await pool.query(`INSERT INTO order_events (order_id, status, message) VALUES ($1,$2,$3)`, [id, status, message]);

  // If delivered: create reminders based on qty/day
  if (status === "delivered") {
    await createRefillRemindersFromOrder({ orderId: id, userId: ord.user_id });
  }

  // WhatsApp push
  const u = await pool.query(`SELECT phone_e164 FROM users WHERE id = $1 LIMIT 1`, [ord.user_id]);
  const phone = u.rows[0]?.phone_e164;
  await maybeNotifyWhatsapp({
    userPhoneE164: phone,
    text: `MedLens: Order #${id} status updated → ${status}${message ? ` (${message})` : ""}`,
  });

  res.json({ ok: true });
});

export default router;

