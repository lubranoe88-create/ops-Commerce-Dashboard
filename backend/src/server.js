import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { assertRuntimeSecrets, config } from "./config.js";
import {
  loginHandlers,
  passwordGate,
} from "./middleware/passwordGate.js";
import { chatRouter } from "./routes/chat.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { initDashboardStore } from "./memory/store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicCandidates = [
  path.resolve(__dirname, "../public"),
  path.resolve(__dirname, "../../public"),
];
const publicDir =
  publicCandidates.find((p) => {
    try {
      return fs.existsSync(path.join(p, "index.html"));
    } catch {
      return false;
    }
  }) || publicCandidates[0];

assertRuntimeSecrets();
initDashboardStore();

const app = express();

app.disable("x-powered-by");
app.use(
  helmet({
    contentSecurityPolicy: false,
  }),
);
app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      return callback(null, true);
    },
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
  }),
);
app.use(express.json({ limit: "64kb" }));
app.use(express.urlencoded({ extended: false, limit: "16kb" }));

loginHandlers(app);
app.use(passwordGate);

const chatLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: config.rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests — try again later" },
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    model: config.openRouterModel,
    purpose: "dashboard_ops",
    secrets_configured: {
      site_password: !config.sitePassword.includes("CHANGE_ME"),
      openrouter: !config.openRouterApiKey.includes("CHANGE_ME"),
    },
  });
});

app.use("/api/chat", chatLimiter, chatRouter);
app.use("/api", chatLimiter, dashboardRouter);

app.use(express.static(publicDir, { index: false }));

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api")) return next();
  res.sendFile(path.join(publicDir, "index.html"), (err) => {
    if (err) next(err);
  });
});

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use((err, _req, res, _next) => {
  if (err?.message === "CORS blocked") {
    return res.status(403).json({ error: "Origin not allowed" });
  }
  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Invalid JSON body" });
  }
  console.error(err);
  return res.status(500).json({ error: "Internal server error" });
});

app.listen(config.port, config.host, () => {
  console.log(`Dashboard listening on http://${config.host}:${config.port}`);
  console.log(`Static UI: ${publicDir}`);
});
