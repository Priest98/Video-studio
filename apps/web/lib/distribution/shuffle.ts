// Per-account clip sequencing and publish scheduling.
// Shuffling manages distribution order and spacing. It is not a way to evade platform
// duplicate-content detection, and nothing here claims it prevents that.

export type Assignments = Record<string, string[]>; // accountId -> clip ids assigned to it

/** Small seeded PRNG so a shuffle can be previewed, saved and reproduced. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates. Returns a new array. */
export function fisherYates<T>(items: readonly T[], rand: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const pairKey = (a: string, b: string) => `${a}\u0000${b}`;

function adjacentPairs(seq: readonly string[]): string[] {
  const pairs: string[] = [];
  for (let i = 0; i < seq.length - 1; i++) pairs.push(pairKey(seq[i], seq[i + 1]));
  return pairs;
}

function sameSequence(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export interface ShuffleOptions {
  seed: number;
  /** Candidate shuffles tried per account; the least repetitive one wins. */
  attempts?: number;
}

/**
 * Independent shuffle per account. Each account gets exactly its assigned clips once.
 * Candidates identical to an earlier account's sequence are rejected when another
 * ordering exists, and candidates that repeat adjacent clip pairs already used by
 * other accounts are penalised.
 */
export function shuffleAssignments(assignments: Assignments, { seed, attempts = 40 }: ShuffleOptions): Assignments {
  const rand = mulberry32(seed);
  const result: Assignments = {};
  const usedPairs = new Map<string, number>();
  const accounts = Object.keys(assignments);

  for (const account of accounts) {
    const clips = assignments[account];
    const canDiffer = new Set(clips).size > 1 && factorialAtLeast(clips.length, accounts.length);
    let best: string[] | null = null;
    let bestScore = Infinity;

    for (let i = 0; i < attempts; i++) {
      const candidate = fisherYates(clips, rand);
      const identicalToPrior =
        canDiffer && Object.values(result).some((seq) => sameSequence(seq, candidate));
      if (identicalToPrior) continue;
      const score = adjacentPairs(candidate).reduce((s, p) => s + (usedPairs.get(p) ?? 0), 0);
      if (score < bestScore) {
        best = candidate;
        bestScore = score;
        if (score === 0) break;
      }
    }
    // Every attempt collided (tiny sets): fall back to a plain shuffle.
    best ??= fisherYates(clips, rand);

    result[account] = best;
    for (const p of adjacentPairs(best)) usedPairs.set(p, (usedPairs.get(p) ?? 0) + 1);
  }
  return result;
}

// n! >= k, computed without overflow for small thresholds.
function factorialAtLeast(n: number, k: number) {
  let f = 1;
  for (let i = 2; i <= n && f < k; i++) f *= i;
  return f >= k;
}

export interface ScheduleOptions {
  start: Date;
  /** Minutes between consecutive posts on one account. */
  intervalMinutes: number;
  /** Minimum minutes between posts of the same clip on different accounts. */
  minCrossAccountGapMinutes: number;
  /** Safety cap on how many slots a post may be pushed back. */
  maxSlotShifts?: number;
}

export interface ScheduledPost {
  accountId: string;
  clipId: string;
  at: Date;
}

/**
 * Assigns publish times. Within an account, posts follow the shuffled order, except that a clip
 * may swap with a later clip in the same account when posting it now would land within the
 * cross-account gap of the same clip elsewhere. If no clip fits a slot, the slot moves later.
 * Nothing is published by this function; it only proposes a plan for approval.
 */
export function scheduleSequences(sequences: Assignments, opts: ScheduleOptions): ScheduledPost[] {
  const { start, intervalMinutes, minCrossAccountGapMinutes, maxSlotShifts = 1000 } = opts;
  if (intervalMinutes <= 0) throw new Error("intervalMinutes must be positive");
  const gapMs = minCrossAccountGapMinutes * 60_000;
  const stepMs = intervalMinutes * 60_000;

  const placed = new Map<string, number[]>(); // clipId -> times already used on any account
  const plan: ScheduledPost[] = [];

  const conflicts = (clipId: string, t: number) =>
    (placed.get(clipId) ?? []).some((other) => Math.abs(other - t) < gapMs);

  for (const accountId of Object.keys(sequences)) {
    const remaining = sequences[accountId].slice();
    let t = start.getTime();
    let shifts = 0;

    while (remaining.length) {
      const idx = remaining.findIndex((clipId) => !conflicts(clipId, t));
      if (idx === -1) {
        if (++shifts > maxSlotShifts) throw new Error(`Could not schedule account ${accountId} within ${maxSlotShifts} slots`);
        t += stepMs;
        continue;
      }
      const [clipId] = remaining.splice(idx, 1);
      plan.push({ accountId, clipId, at: new Date(t) });
      placed.set(clipId, [...(placed.get(clipId) ?? []), t]);
      t += stepMs;
    }
  }
  return plan;
}
