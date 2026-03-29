import { Router } from "express";
import { pool } from "../db/pool.js";
import {
  fetchMediaBytes,
  isWhatsappConfigured,
  sendTextMessage,
} from "../integrations/whatsappCloud.js";
import { ocrImageBytes } from "../ocr/ocr.js";
import { matchMedicinesFromText } from "../prescription/parse.js";

const router = Router();

router.get("/", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

router.post("/", async (req, res) => {
  // Acknowledge fast; do work async to avoid WhatsApp retries.
  res.sendStatus(200);

  if (!isWhatsappConfigured()) return;

  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const messages = value?.messages || [];
    const phoneNumberId = value?.metadata?.phone_number_id;

    for (const msg of messages) {
      const waFrom = msg.from; // wa_id
      const messageId = msg.id;

      const image = msg.image;
      if (!image?.id) {
        await sendTextMessage({
          toWaId: waFrom,
          text:
            "Please send a clear photo of the prescription (as an image). PDF/document support is coming next.",
        }).catch(() => {});
        continue;
      }

      const mediaId = image.id;
      const mediaBytes = await fetchMediaBytes(mediaId);
      const ocrText = await ocrImageBytes(mediaBytes);
      const matches = await matchMedicinesFromText(ocrText);

      const sourceRef = `wa:${phoneNumberId || "unknown"}:${messageId}`;
      const cartRes = await pool.query(
        `INSERT INTO carts (source, source_ref, wa_from, wa_message_id, status, ocr_text)
         VALUES ('whatsapp', $1, $2, $3, $4, $5)
         RETURNING id`,
        [
          sourceRef,
          waFrom,
          messageId,
          matches.length ? "ready" : "failed",
          ocrText,
        ]
      );
      const cartId = cartRes.rows[0].id;

      for (const m of matches) {
        await pool.query(
          `INSERT INTO cart_items (cart_id, medicine_id, quantity, match_score, match_line)
           VALUES ($1, $2, 1, $3, $4)
           ON CONFLICT (cart_id, medicine_id)
           DO UPDATE SET match_score = EXCLUDED.match_score, match_line = EXCLUDED.match_line`,
          [cartId, m.medicine_id, m.score, m.match_line]
        );
      }

      const baseUrl = (process.env.APP_BASE_URL || "").replace(/\/$/, "");
      const cartUrl = baseUrl ? `${baseUrl}/cart.html?id=${cartId}` : null;

      const lines = matches
        .slice(0, 6)
        .map((m, i) => `${i + 1}. ${m.display_name} (match ${(m.score * 100).toFixed(0)}%)`)
        .join("\n");

      const reply =
        matches.length > 0
          ? `I found these medicines from your prescription:\n${lines}\n\nOpen cart: ${cartUrl || `cart #${cartId}`}\n\nReply “edit” if anything looks off (handwritten prescriptions may need manual confirmation).`
          : `I couldn’t confidently read medicines from that photo.\nTip: send a brighter, sharper image (no glare), or type the medicine names.\nCart: ${cartUrl || `#${cartId}`}`;

      await sendTextMessage({ toWaId: waFrom, text: reply }).catch(() => {});
    }
  } catch (e) {
    // Avoid throwing; webhook already 200'd.
    console.error("WhatsApp webhook processing error:", e);
  }
});

export default router;

