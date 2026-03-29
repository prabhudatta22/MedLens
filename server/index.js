import "dotenv/config";
import express from "express";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import api from "./routes/api.js";
import whatsapp from "./routes/whatsapp.js";
import importRoutes from "./routes/import.js";
import partnerRoutes from "./routes/partner.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "..", "public");

const app = express();
const port = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: "2mb" }));
app.use(express.static(publicDir));
app.use("/api", api);
app.use("/api/import", importRoutes);
app.use("/api/partner", partnerRoutes);
app.use("/webhook/whatsapp", whatsapp);

app.get("*", (_req, res) => {
  res.sendFile(join(publicDir, "index.html"));
});

app.listen(port, () => {
  console.log(`MedLens (India) http://localhost:${port}`);
});
