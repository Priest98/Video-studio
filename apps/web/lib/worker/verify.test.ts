import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyCallback } from "./verify.ts";

const sign = (s: string, ts: string, body: string) => createHmac("sha256", s).update(`${ts}.${body}`).digest("hex");

test("accepts a correct, fresh signature", () => {
  const body = '{"a":1}';
  assert.equal(verifyCallback("s", "1000", sign("s", "1000", body), body, 1100), true);
});
test("rejects wrong secret, tampered body, stale timestamp and missing parts", () => {
  const body = '{"a":1}', good = sign("s", "1000", body);
  assert.equal(verifyCallback("x", "1000", good, body, 1000), false);
  assert.equal(verifyCallback("s", "1000", good, '{"a":2}', 1000), false);
  assert.equal(verifyCallback("s", "1000", good, body, 2000), false);
  assert.equal(verifyCallback("s", null, good, body, 1000), false);
  assert.equal(verifyCallback("", "1000", good, body, 1000), false);
  assert.equal(verifyCallback("s", "1000", "zz", body, 1000), false);
});
