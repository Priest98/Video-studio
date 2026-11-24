import { test } from "node:test";
import assert from "node:assert/strict";
import { clipCaption } from "./caption.ts";

test("uses the description when there is one", () => {
  assert.equal(clipCaption({ description: " Big  moment ", hook: "h", title: "t" }), "Big moment");
});
test("an empty description falls back to the hook, then the title", () => {
  assert.equal(clipCaption({ description: "", hook: "Watch this", title: "t" }), "Watch this");
  assert.equal(clipCaption({ description: "  ", hook: null, title: "Title" }), "Title");
});
test("nothing to use gives undefined", () => {
  assert.equal(clipCaption({ description: "", hook: "", title: null }), undefined);
});
