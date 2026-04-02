function basicNormalize(q) {
  const raw = String(q || "").trim();
  if (!raw) return { normalized: "", changes: [] };

  let s = raw;
  const changes = [];

  const beforeSpace = s;
  s = s.replace(/\s+/g, " ").trim();
  if (s !== beforeSpace) changes.push("whitespace");

  const beforePunct = s;
  s = s.replace(/[^\w\s.+-]/g, " ").replace(/\s+/g, " ").trim();
  if (s !== beforePunct) changes.push("punctuation");

  // Common unit normalization: "650mg" -> "650 mg"
  const beforeUnits = s;
  s = s.replace(/(\d)(mg|ml|mcg|g)\b/gi, "$1 $2");
  if (s !== beforeUnits) changes.push("units");

  return { normalized: s, changes };
}

async function aiNormalize(q) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;

  // Minimal, safe normalization prompt. Returns JSON only.
  const prompt = `Normalize this Indian medicine or lab-test query for search.
- Fix spacing and common abbreviations.
- Keep meaning; do not add new medicines.
- Return strict JSON: {"normalized":"...","notes":"..."}.

Query: ${JSON.stringify(String(q || ""))}`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: "You return strict JSON only." },
        { role: "user", content: prompt },
      ],
      temperature: 0.1,
    }),
  });

  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  const txt = data?.choices?.[0]?.message?.content;
  if (!txt) return null;

  try {
    const parsed = JSON.parse(txt);
    const normalized = String(parsed.normalized || "").trim();
    if (!normalized) return null;
    return { normalized, notes: String(parsed.notes || "") };
  } catch {
    return null;
  }
}

export async function normalizeQuery(q) {
  const base = basicNormalize(q);
  const ai = await aiNormalize(base.normalized);
  if (ai?.normalized) {
    return {
      input: String(q || ""),
      normalized: ai.normalized,
      used: "ai",
      changes: base.changes,
      notes: ai.notes || "",
    };
  }
  return {
    input: String(q || ""),
    normalized: base.normalized,
    used: "rules",
    changes: base.changes,
    notes: "",
  };
}

