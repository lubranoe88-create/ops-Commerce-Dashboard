import crypto from "node:crypto";
import { config } from "../config.js";

export const AUTH_COOKIE = "dash_auth";

function timingSafeEqualString(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) {
    // Still compare to reduce trivial timing leaks on length
    crypto.timingSafeEqual(left, left);
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

function signToken() {
  return crypto
    .createHmac("sha256", config.sessionSecret)
    .update("authenticated")
    .digest("hex");
}

export function isAuthenticated(req) {
  const cookieHeader = req.headers.cookie || "";
  const match = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${AUTH_COOKIE}=`));
  if (!match) return false;
  const value = decodeURIComponent(match.slice(AUTH_COOKIE.length + 1));
  return timingSafeEqualString(value, signToken());
}

export function setAuthCookie(res) {
  // No Max-Age / Expires → no idle session timeout; lasts for the browser session.
  const secure = process.env.COOKIE_SECURE === "true" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${AUTH_COOKIE}=${encodeURIComponent(signToken())}; HttpOnly; Path=/; SameSite=Lax${secure}`,
  );
}

export function clearAuthCookie(res) {
  res.setHeader(
    "Set-Cookie",
    `${AUTH_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`,
  );
}

function wantsHtml(req) {
  const accept = req.headers.accept || "";
  return accept.includes("text/html");
}

function loginPage({ error } = {}) {
  const errorHtml = error
    ? `<p style="color:#b00020;margin:0 0 12px;font-size:14px">${error}</p>`
    : "";
  return `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Accesso</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #0f1115; color: #e8eaed; min-height: 100vh; display: grid; place-items: center; margin: 0; }
    form { background: #1a1d24; padding: 28px; border-radius: 12px; width: min(360px, 92vw); border: 1px solid #2a2f3a; }
    label { display: block; font-size: 13px; margin-bottom: 8px; color: #aeb4bf; }
    input[type=password] { width: 100%; box-sizing: border-box; padding: 10px 12px; border-radius: 8px; border: 1px solid #3a4150; background: #0f1115; color: #e8eaed; margin-bottom: 14px; }
    button { width: 100%; padding: 10px 12px; border: 0; border-radius: 8px; background: #4c6fff; color: white; font-weight: 600; cursor: pointer; }
  </style>
</head>
<body>
  <form method="POST" action="/login" autocomplete="current-password">
    <label for="password">Password</label>
    ${errorHtml}
    <input id="password" name="password" type="password" required autofocus />
    <button type="submit">Entra</button>
  </form>
</body>
</html>`;
}

export function passwordGate(req, res, next) {
  // Public: login + platform health probes (no secrets leaked beyond placeholders status)
  if (req.path === "/login" || req.path === "/health") return next();
  // Static UI assets must load even before/during auth cookie settle
  if (
    req.path.startsWith("/css/") ||
    req.path.startsWith("/js/") ||
    req.path === "/favicon.ico"
  ) {
    return next();
  }
  if (isAuthenticated(req)) return next();

  if (wantsHtml(req)) {
    return res.status(401).type("html").send(loginPage());
  }
  return res.status(401).json({ error: "Authentication required" });
}

export function loginHandlers(app) {
  app.get("/login", (req, res) => {
    if (isAuthenticated(req)) {
      return res.redirect("/");
    }
    return res.type("html").send(loginPage());
  });

  app.post("/login", (req, res) => {
    const password =
      (typeof req.body?.password === "string" && req.body.password) || "";
    if (!timingSafeEqualString(password, config.sitePassword)) {
      if (wantsHtml(req) || req.headers["content-type"]?.includes("form")) {
        return res.status(401).type("html").send(loginPage({ error: "Password non valida" }));
      }
      return res.status(401).json({ error: "Invalid password" });
    }
    setAuthCookie(res);
    const accept = req.headers.accept || "";
    if (accept.includes("application/json")) {
      return res.json({ ok: true });
    }
    return res.redirect("/");
  });

  app.post("/logout", (_req, res) => {
    clearAuthCookie(res);
    const accept = _req.headers.accept || "";
    if (accept.includes("application/json")) {
      return res.json({ ok: true });
    }
    return res.redirect("/login");
  });

  // Compat aliases used by the SPA
  app.post("/api/auth/logout", (_req, res) => {
    clearAuthCookie(res);
    return res.json({ ok: true });
  });
  app.post("/api/auth/login", (req, res) => {
    const password =
      (typeof req.body?.password === "string" && req.body.password) || "";
    if (!timingSafeEqualString(password, config.sitePassword)) {
      return res.status(401).json({ error: "Invalid password" });
    }
    setAuthCookie(res);
    return res.json({ ok: true });
  });
}
