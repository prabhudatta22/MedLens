function requiredEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}

export function isWhatsappConfigured() {
  return Boolean(
    process.env.WHATSAPP_ACCESS_TOKEN &&
      process.env.WHATSAPP_PHONE_NUMBER_ID &&
      process.env.WHATSAPP_VERIFY_TOKEN
  );
}

export async function fetchMediaBytes(mediaId) {
  const token = requiredEnv("WHATSAPP_ACCESS_TOKEN");
  const metaRes = await fetch(`https://graph.facebook.com/v19.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!metaRes.ok) {
    throw new Error(`WhatsApp media meta failed: ${metaRes.status}`);
  }
  const meta = await metaRes.json();
  if (!meta.url) throw new Error("WhatsApp media meta missing url");

  const binRes = await fetch(meta.url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!binRes.ok) {
    throw new Error(`WhatsApp media download failed: ${binRes.status}`);
  }
  const ab = await binRes.arrayBuffer();
  return new Uint8Array(ab);
}

export async function sendTextMessage({ toWaId, text }) {
  const token = requiredEnv("WHATSAPP_ACCESS_TOKEN");
  const phoneNumberId = requiredEnv("WHATSAPP_PHONE_NUMBER_ID");

  const res = await fetch(
    `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: toWaId,
        type: "text",
        text: { body: text, preview_url: true },
      }),
    }
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`WhatsApp send failed: ${res.status} ${body}`);
  }
  return await res.json();
}

