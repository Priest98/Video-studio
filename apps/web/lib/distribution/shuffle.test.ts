import { test } from "node:test";
import assert from "node:assert/strict";
import { shuffleAssignments, scheduleSequences, fisherYates, mulberry32 } from "./shuffle.ts";

const clips = Array.from({ length: 30 }, (_, i) => `c${String(i + 1).padStart(2, "0")}`);
const four = { A: clips, B: clips, C: clips, D: clips };

test("each account gets every assigned clip exactly once", () => {
  const out = shuffleAssignments(four, { seed: 1 });
  for (const acc of Object.keys(four)) assert.deepEqual(out[acc].slice().sort(), clips.slice().sort());
});

test("no two accounts share the same sequence", () => {
  for (let seed = 0; seed < 50; seed++) {
    const out = shuffleAssignments(four, { seed });
    const keys = Object.values(out).map((s) => s.join(","));
    assert.equal(new Set(keys).size, 4);
  }
});

test("same seed reproduces the same plan; different seed differs", () => {
  assert.deepEqual(shuffleAssignments(four, { seed: 7 }), shuffleAssignments(four, { seed: 7 }));
  assert.notDeepEqual(shuffleAssignments(four, { seed: 7 }), shuffleAssignments(four, { seed: 8 }));
});

test("different assignments per account are respected", () => {
  const out = shuffleAssignments({ A: ["x", "y"], B: ["y", "z", "w"] }, { seed: 3 });
  assert.deepEqual(out.A.slice().sort(), ["x", "y"]);
  assert.deepEqual(out.B.slice().sort(), ["w", "y", "z"]);
});

test("tiny sets do not loop or throw", () => {
  const out = shuffleAssignments({ A: ["x"], B: ["x"] }, { seed: 1 });
  assert.deepEqual(out, { A: ["x"], B: ["x"] });
});

test("fisher-yates is roughly uniform for 3 items", () => {
  const rand = mulberry32(42);
  const counts = new Map<string, number>();
  for (let i = 0; i < 6000; i++) {
    const k = fisherYates(["a", "b", "c"], rand).join("");
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  assert.equal(counts.size, 6);
  for (const n of counts.values()) assert.ok(n > 800 && n < 1200, `count ${n}`);
});

test("shuffling reduces repeated adjacent pairs across accounts", () => {
  const out = shuffleAssignments(four, { seed: 11 });
  const seen = new Map<string, number>();
  for (const seq of Object.values(out))
    for (let i = 0; i < seq.length - 1; i++) {
      const k = seq[i] + seq[i + 1];
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
  const repeats = [...seen.values()].filter((n) => n > 1).length;
  assert.ok(repeats <= 2, `repeated pairs: ${repeats}`);
});

test("the same clip never posts on two accounts within the minimum gap", () => {
  const seqs = shuffleAssignments(four, { seed: 5 });
  const gap = 90;
  const plan = scheduleSequences(seqs, {
    start: new Date("2026-12-01T09:00:00Z"),
    intervalMinutes: 60,
    minCrossAccountGapMinutes: gap,
  });
  assert.equal(plan.length, 120);
  const byClip = new Map<string, number[]>();
  for (const p of plan) byClip.set(p.clipId, [...(byClip.get(p.clipId) ?? []), p.at.getTime()]);
  for (const times of byClip.values()) {
    times.sort((a, b) => a - b);
    for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= gap * 60_000);
  }
});

test("each account keeps its own clips once and times are increasing", () => {
  const seqs = shuffleAssignments(four, { seed: 9 });
  const plan = scheduleSequences(seqs, { start: new Date("2026-12-01T09:00:00Z"), intervalMinutes: 30, minCrossAccountGapMinutes: 60 });
  for (const acc of Object.keys(four)) {
    const mine = plan.filter((p) => p.accountId === acc);
    assert.deepEqual(mine.map((p) => p.clipId).sort(), clips.slice().sort());
    for (let i = 1; i < mine.length; i++) assert.ok(mine[i].at > mine[i - 1].at);
  }
});

test("rejects non-positive interval", () => {
  assert.throws(() => scheduleSequences({ A: ["x"] }, { start: new Date(), intervalMinutes: 0, minCrossAccountGapMinutes: 0 }));
});
