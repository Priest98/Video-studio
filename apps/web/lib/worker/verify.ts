import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_SKEW_SECONDS = 300;

/** Verifies the worker's HMAC over `${timestamp}.${rawBody}` and rejects stale timestamps (replay window). */
export function verifyCallback(secret: string, timestamp: string | null, signature: string | null, rawBody: string, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!secret || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > MAX_SKEW_SECONDS) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest();
  let given: Buffer;
  try { given = Buffer.from(signature, "hex"); } catch { return false; }
  return given.length === expected.length && timingSafeEqual(given, expected);
}
