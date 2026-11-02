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
import { aiRouter } from "./routes/ai.js";
import { initDashboardStore } from "./memory/store.js";
import { ensureAiSchema } from "./memory/aiStore.js";
import { getDb } from "./memory/db.js";
import { refreshWorldNews } from "./services/newsIngest.js";
import { applyBrowserUseRuntimeEnv } from "./services/browserUseRuntime.js";

applyBrowserUseRuntimeEnv();

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
ensureAiSchema(getDb());
// Mechanical news warm (no AI)
refreshWorldNews({ force: true }).catch((err) =>
  console.warn("[news] warm failed", err?.message || err),
);

const app = express();

app.disable("x-powered-by");
app.use(
  helmet({
    contentSecurityPolicy: false,
  }),
);
// Explicit allow for Safari/iOS getUserMedia + SpeechRecognition (Helmet 8 may omit this)
app.use((_req, res, next) => {
  res.setHeader(
    "Permissions-Policy",
    "microphone=(self), camera=(), geolocation=()",
  );
  next();
});
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
// 5mb allows short mic recordings (Safari/iOS MediaRecorder → /api/ai/transcribe)
app.use(express.json({ limit: "5mb" }));
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
    build: "rail-15",
    browserProbe: "example-1",
    model: config.openRouterModel,
    routerModel: config.aiRouterModel,
    grokModel: config.aiGrokModel,
    purpose: "dashboard_ops",
    aiEntitlement: config.aiEntitlement,
    secrets_configured: {
      site_password: !config.sitePassword.includes("CHANGE_ME"),
      openrouter: !config.openRouterApiKey.includes("CHANGE_ME"),
    },
  });
});

app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
app.use("/api/chat", chatLimiter, chatRouter);
// Function board polls every ~20s; keep it off the tight chat limiter so the
// 2D grid does not stay empty under interactive QA / multi-tab use.
app.use("/api/ai", (req, res, next) => {
  const p = String(req.path || "");
  // Keep interactive voice + board polling off the tight chat limiter.
  if (
    p.startsWith("/function-board") ||
    p === "/speak" ||
    p === "/transcribe" ||
    p.startsWith("/agentq/")
  ) {
    return next();
  }
  return chatLimiter(req, res, next);
}, aiRouter);
app.use("/api", chatLimiter, dashboardRouter);

app.use(
  express.static(publicDir, {
    index: false,
    setHeaders(res, filePath) {
      // Avoid stale SPA shells / modules after deploy (tablet browsers cache aggressively)
      if (/\.(?:js|css|html)$/i.test(filePath)) {
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
        res.setHeader("Pragma", "no-cache");
      }
    },
  }),
);

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api")) return next();
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
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
