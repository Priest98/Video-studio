import { test } from "node:test";
import assert from "node:assert/strict";
import { bearerMatches, parseWorkerUrl } from "./endpoint.ts";

test("accepts quick tunnel addresses and normalises them", () => {
  assert.equal(parseWorkerUrl("https://quiet-river-1234.trycloudflare.com/"), "https://quiet-river-1234.trycloudflare.com");
  assert.equal(parseWorkerUrl("https://a.trycloudflare.com/jobs?x=1"), "https://a.trycloudflare.com");
});
test("rejects anything else", () => {
  for (const bad of ["http://a.trycloudflare.com", "https://evil.com", "https://trycloudflare.com", "https://a.trycloudflare.com.evil.com",
    "https://u:p@a.trycloudflare.com", "https://a.trycloudflare.com:8443", "not a url", 42, null]) assert.equal(parseWorkerUrl(bad), null, String(bad));
});
test("named tunnel suffixes come only from configuration", () => {
  assert.equal(parseWorkerUrl("https://worker.example.com", "example.com"), "https://worker.example.com");
  assert.equal(parseWorkerUrl("https://worker.example.com"), null);
  assert.equal(parseWorkerUrl("https://notexample.com", "example.com"), null);
});
test("bearer comparison", () => {
  assert.equal(bearerMatches("Bearer abc", "abc"), true);
  assert.equal(bearerMatches("Bearer abd", "abc"), false);
  assert.equal(bearerMatches("abc", "abc"), false);
  assert.equal(bearerMatches("Bearer abc", undefined), false);
  assert.equal(bearerMatches(null, "abc"), false);
});
