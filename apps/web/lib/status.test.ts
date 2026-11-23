import { test } from "node:test";
import assert from "node:assert/strict";
import { statusLabel } from "./status.ts";

test("every status has plain words and unknown falls back to waiting", () => {
  assert.equal(statusLabel("ready").text, "Ready");
  assert.equal(statusLabel("processing").text, "Working on it");
  assert.equal(statusLabel("failed").text, "Something went wrong");
  assert.equal(statusLabel("queued").text, "Waiting to start");
  assert.equal(statusLabel("whatever").text, "Waiting to start");
});
