import { test } from "node:test";
import assert from "node:assert/strict";
import { decrypt, encrypt } from "./crypto.ts";

const k = Buffer.alloc(32, 7).toString("base64");

test("round trips and never repeats ciphertext", () => {
  const a = encrypt("ptk_secret", k), b = encrypt("ptk_secret", k);
  assert.notEqual(a, b);
  assert.equal(decrypt(a, k), "ptk_secret");
  assert.ok(!a.includes("ptk_secret"));
});
test("tampering and wrong key are rejected", () => {
  const blob = encrypt("x", k);
  const parts = blob.split(".");
  parts[3] = Buffer.from("tampered").toString("base64url");
  assert.throws(() => decrypt(parts.join("."), k));
  assert.throws(() => decrypt(blob, Buffer.alloc(32, 9).toString("base64")));
  assert.throws(() => encrypt("x", "short"));
});
