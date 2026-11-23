import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSettings, workerJob } from "./job.ts";

test("defaults and clamping", () => {
  const s = parseSettings({ caption_style: "evil", quality: "ultra", selection: { clip_count: 999, min_seconds: 100, max_seconds: 5 } });
  assert.equal(s.caption_style, "bold_animated");
  assert.equal(s.quality, "standard");
  assert.equal(s.selection.clip_count, 20);
  assert.ok(s.selection.min_seconds <= s.selection.max_seconds);
  assert.deepEqual(parseSettings(undefined).selection.categories, []);
});
test("valid choices pass through and categories are bounded", () => {
  const s = parseSettings({ caption_style: "cinematic", caption_mode: "sentence", quality: "small", selection: { categories: Array(20).fill("x".repeat(100)) } });
  assert.equal(s.caption_style, "cinematic"); assert.equal(s.caption_mode, "sentence"); assert.equal(s.quality, "small");
  assert.equal(s.selection.categories.length, 8); assert.equal(s.selection.categories[0].length, 40);
});
test("worker job carries tenant ids and callback, and drops unknown settings keys", () => {
  const j = workerJob({ id: "p", workspace_id: "w", settings: { source_path: "/etc/passwd", caption_style: "minimal" } }, { source_url: "https://x" }, "https://app.test");
  assert.equal(j.callback_url, "https://app.test/api/worker/callback");
  assert.equal(j.project_id, "p"); assert.equal(j.workspace_id, "w");
  assert.ok(!("source_path" in j));
});
