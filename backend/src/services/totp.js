/**
 * Minimal TOTP (RFC 6238) — no extra deps.
 * Enabled only when SITE_TOTP_SECRET (base32) is set in env.
 */
import crypto from "node:crypto";

function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const cleaned = String(input || "")
    .toUpperCase()
    .replace(/=+$/g, "")
    .replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const ch of cleaned) {
    const val = alphabet.indexOf(ch);
    if (val < 0) continue;
    bits += val.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

export function isTotpEnabled() {
  const secret = process.env.SITE_TOTP_SECRET?.trim();
  return Boolean(secret && secret.length >= 8);
}

export function verifyTotp(token, { window = 1 } = {}) {
  const secret = process.env.SITE_TOTP_SECRET?.trim();
  if (!secret) return true; // disabled → always ok
  const code = String(token || "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(code)) return false;
  const key = base32Decode(secret);
  const step = 30;
  const now = Math.floor(Date.now() / 1000 / step);
  for (let w = -window; w <= window; w += 1) {
    const counter = Buffer.alloc(8);
    counter.writeUInt32BE(0, 0);
    counter.writeUInt32BE(now + w, 4);
    const hmac = crypto.createHmac("sha1", key).update(counter).digest();
    const offset = hmac[hmac.length - 1] & 0xf;
    const bin =
      ((hmac[offset] & 0x7f) << 24) |
      ((hmac[offset + 1] & 0xff) << 16) |
      ((hmac[offset + 2] & 0xff) << 8) |
      (hmac[offset + 3] & 0xff);
    const hotp = String(bin % 1_000_000).padStart(6, "0");
    if (hotp === code) return true;
  }
  return false;
}
