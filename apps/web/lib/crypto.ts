import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function key(raw = process.env.TOKEN_ENCRYPTION_KEY): Buffer {
  const k = Buffer.from(raw ?? "", "base64");
  if (k.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes, base64 encoded");
  return k;
}

/** AES-256-GCM. Output: v1.iv.tag.ciphertext (base64url). Used for Oyinca tokens at rest. */
export function encrypt(plain: string, raw?: string): string {
  const iv = randomBytes(12), c = createCipheriv("aes-256-gcm", key(raw), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

export function decrypt(blob: string, raw?: string): string {
  const [v, iv, tag, ct] = blob.split(".");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("unrecognised ciphertext");
  const d = createDecipheriv("aes-256-gcm", key(raw), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
}
