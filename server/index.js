import "dotenv/config";
import express from "express";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import api from "./routes/api.js";
import whatsapp from "./routes/whatsapp.js";
import importRoutes from "./routes/import.js";
import partnerRoutes from "./routes/partner.js";
import authRoutes from "./routes/auth.js";
import remindersRoutes from "./routes/reminders.js";
import onlineCompareRoutes from "./routes/onlineCompare.js";
import geocodeRoutes from "./routes/geocode.js";
import catalogRoutes from "./routes/catalog.js";
import ordersRoutes from "./routes/orders.js";
import profileRoutes from "./routes/profile.js";
import prescriptionsRoutes from "./routes/prescriptions.js";
import cookieParser from "cookie-parser";
import { attachUser } from "./auth/middleware.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "..", "public");

const app = express();
const port = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());
app.use(attachUser);
app.use(express.static(publicDir));
app.use("/api/geocode", geocodeRoutes);
app.use("/api/catalog", catalogRoutes);
app.use("/api", api);
app.use("/api/auth", authRoutes);
app.use("/api/reminders", remindersRoutes);
app.use("/api/online", onlineCompareRoutes);
app.use("/api/import", importRoutes);
app.use("/api/partner", partnerRoutes);
app.use("/api/orders", ordersRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/prescriptions", prescriptionsRoutes);
app.use("/webhook/whatsapp", whatsapp);

app.get("*", (_req, res) => {
  res.sendFile(join(publicDir, "index.html"));
});

app.listen(port, () => {
  console.log(`MedLens (India) http://localhost:${port}`);
});
