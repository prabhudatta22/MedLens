function num(x) {
  if (x == null) return null;
  const n = Number(x);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Best-effort: find first product-like object in a partner JSON payload and read price fields.
 * Partner schemas differ; configure mapping later if one partner returns a fixed shape.
 */
export function parseFirstProductOffer(json, searchQuery) {
  if (!json || typeof json !== "object") return null;

  const candidates = [];

  function walk(node, depth) {
    if (!node || typeof node !== "object" || depth > 18) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }

    const priceKeys = [
      "selling_price",
      "sale_price",
      "discounted_price",
      "final_price",
      "price",
      "amount",
      "sp",
      "offer_price",
    ];
    const mrpKeys = ["mrp", "max_retail_price", "list_price", "strike_price", "original_price"];

    let p;
    let m;
    for (const k of priceKeys) {
      if (k in node) {
        const v = num(node[k]);
        if (v != null) {
          p = v;
          break;
        }
      }
    }
    for (const k of mrpKeys) {
      if (k in node) {
        const v = num(node[k]);
        if (v != null) {
          m = v;
          break;
        }
      }
    }

    if (p != null || m != null) {
      const title =
        node.name ||
        node.title ||
        node.product_name ||
        node.sku_name ||
        node.display_name ||
        node.medicine_name ||
        null;
      candidates.push({
        price_inr: p ?? m,
        mrp_inr: m ?? p,
        title: typeof title === "string" ? title : null,
        _depth: depth,
      });
    }

    for (const v of Object.values(node)) walk(v, depth + 1);
  }

  walk(json, 0);
  if (!candidates.length) return null;

  const q = String(searchQuery || "")
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 2);

  function score(c) {
    let s = 0;
    if (c.title && q.length) {
      const t = c.title.toLowerCase();
      for (const word of q) if (t.includes(word)) s += 3;
    }
    s -= c._depth * 0.01;
    return s;
  }

  candidates.sort((a, b) => score(b) - score(a));
  const best = candidates[0];
  return {
    price_inr: Math.round(best.price_inr * 100) / 100,
    mrp_inr: Math.round(best.mrp_inr * 100) / 100,
    title: best.title,
  };
}
