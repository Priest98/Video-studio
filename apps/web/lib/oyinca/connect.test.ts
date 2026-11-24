import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { buildAuthorizeUrl, decodeAttempt, encodeAttempt, exchangeCode, newConnectAttempt, oyincaWebUrl } from "./connect.ts";

test("challenge is the S256 hash of the verifier and attempts are unique", () => {
  const a = newConnectAttempt(), b = newConnectAttempt();
  assert.equal(a.challenge, createHash("sha256").update(a.verifier).digest("base64url"));
  assert.equal(a.verifier.length, 43);
  assert.notEqual(a.state, b.state);
});

test("authorize URL goes to Oyinca's connect page and never carries the verifier", () => {
  const a = newConnectAttempt();
  const url = new URL(buildAuthorizeUrl("https://oyinca.com", "https://studio.example/api/oyinca/callback", a));
  assert.equal(url.pathname, "/connect/video-studio");
  assert.equal(url.searchParams.get("code_challenge"), a.challenge);
  assert.equal(url.searchParams.get("state"), a.state);
  assert.ok(!url.toString().includes(a.verifier));
});

test("attempt cookie round-trips and rejects junk", () => {
  const a = newConnectAttempt();
  assert.deepEqual(decodeAttempt(encodeAttempt(a)), { verifier: a.verifier, state: a.state });
  assert.equal(decodeAttempt("###"), null);
  assert.equal(decodeAttempt(undefined), null);
});

test("web address derives from the API address", () => {
  process.env.OYINCA_API_URL = "https://oyinca.com/api";
  delete process.env.OYINCA_WEB_URL;
  assert.equal(oyincaWebUrl(), "https://oyinca.com");
});

test("exchange posts code and verifier and returns the token", async () => {
  const real = globalThis.fetch;
  let sent: unknown;
  globalThis.fetch = (async (_u: unknown, init?: RequestInit) => { sent = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ token: "ptk_x" }), { status: 201 }); }) as typeof fetch;
  try {
    assert.deepEqual(await exchangeCode("https://oyinca.com/api", "pac_1", "v", "https://s/cb"), { token: "ptk_x" });
    assert.deepEqual(sent, { code: "pac_1", codeVerifier: "v", redirectUri: "https://s/cb" });
    globalThis.fetch = (async () => new Response("no", { status: 401 })) as typeof fetch;
    await assert.rejects(exchangeCode("https://oyinca.com/api", "bad", "v", "https://s/cb"));
  } finally { globalThis.fetch = real; }
});
