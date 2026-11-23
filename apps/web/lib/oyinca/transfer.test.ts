import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HttpOyincaClient, OyincaAuthError, OyincaTransientError, type OyincaClient, type SubmitClipRequest,
} from "./client.ts";
import { idempotencyKey, processBatch, processTransfer, type TransferRow, type TransferStore } from "./transfer.ts";

function memoryStore(rows: TransferRow[]) {
  const expired: string[] = [];
  const store: TransferStore = {
    async update(id, patch) { Object.assign(rows.find((r) => r.id === id)!, patch); },
    async markConnectionExpired(itemId) { expired.push(itemId); },
  };
  return { store, expired };
}
const row = (id: string): TransferRow => ({ id, itemId: `item-${id}`, idempotencyKey: idempotencyKey("plan", id), status: "pending", attempts: 0 });
const req = async (): Promise<SubmitClipRequest> => ({
  idempotencyKey: "", brandId: "b", accountId: "a", videoUrl: "https://signed", filename: "c.mp4", mimeType: "video/mp4", sizeBytes: 1,
});

test("success lands in awaiting_approval, never published", async () => {
  const rows = [row("1")];
  const { store } = memoryStore(rows);
  const client: OyincaClient = { listAccounts: async () => [], submitClip: async () => ({ assetId: "asset-1", state: "awaiting_approval" }) };
  assert.equal(await processTransfer(store, client, rows[0], req), "awaiting_approval");
  assert.equal(rows[0].oyincaAssetId, "asset-1");
  assert.ok(!("publish" in client));
});

test("one account failing does not cancel the others", async () => {
  const rows = [row("1"), row("2"), row("3")];
  const { store } = memoryStore(rows);
  const client: OyincaClient = {
    listAccounts: async () => [],
    async submitClip(r) {
      if (r.idempotencyKey === rows[1].idempotencyKey) throw new Error("rejected");
      return { assetId: "ok", state: "awaiting_approval" };
    },
  };
  const out = await processBatch(store, client, rows, req);
  assert.deepEqual(out, { "1": "awaiting_approval", "2": "failed", "3": "awaiting_approval" });
});

test("retry does not resubmit delivered items and reuses the idempotency key", async () => {
  const rows = [row("1"), row("2")];
  const { store } = memoryStore(rows);
  const calls: string[] = [];
  let failOnce = true;
  const client: OyincaClient = {
    listAccounts: async () => [],
    async submitClip(r) {
      calls.push(r.idempotencyKey);
      if (r.idempotencyKey === rows[1].idempotencyKey && failOnce) { failOnce = false; throw new OyincaTransientError("503"); }
      return { assetId: "x", state: "awaiting_approval" };
    },
  };
  await processBatch(store, client, rows, req);
  assert.equal(rows[1].status, "pending");
  await processBatch(store, client, rows, req); // the retry sweep
  assert.deepEqual(rows.map((r) => r.status), ["awaiting_approval", "awaiting_approval"]);
  assert.equal(calls.filter((k) => k === rows[0].idempotencyKey).length, 1); // delivered once
  assert.equal(calls.filter((k) => k === rows[1].idempotencyKey).length, 2); // same key on retry
});

test("transient errors give up after the attempt limit", async () => {
  const rows = [row("1")];
  const { store } = memoryStore(rows);
  const client: OyincaClient = { listAccounts: async () => [], submitClip: async () => { throw new OyincaTransientError("down"); } };
  for (let i = 0; i < 3; i++) await processTransfer(store, client, rows[0], req);
  assert.equal(rows[0].status, "failed");
  assert.equal(rows[0].attempts, 3);
});

test("expired credentials fail fast and flag the connection", async () => {
  const rows = [row("1")];
  const { store, expired } = memoryStore(rows);
  const client: OyincaClient = { listAccounts: async () => [], submitClip: async () => { throw new OyincaAuthError("expired"); } };
  assert.equal(await processTransfer(store, client, rows[0], req), "failed");
  assert.deepEqual(expired, ["item-1"]);
  assert.equal(rows[0].attempts, 1);
});

test("http client maps statuses to the right error classes and sends the idempotency header", async () => {
  const seen: Record<string, string>[] = [];
  const mk = (status: number) =>
    new HttpOyincaClient("https://o.test", async () => "tok", undefined, (async (_u: string, init: RequestInit) => {
      seen.push(init.headers as Record<string, string>);
      return new Response(status === 200 ? JSON.stringify({ assetId: "a", state: "awaiting_approval" }) : "no", { status });
    }) as unknown as typeof fetch);
  const r = await req();
  assert.equal((await mk(200).submitClip({ ...r, idempotencyKey: "k1" })).assetId, "a");
  assert.equal(seen[0]["idempotency-key"], "k1");
  assert.equal(seen[0].authorization, "Bearer tok");
  await assert.rejects(mk(401).submitClip({ ...r, idempotencyKey: "k" }), OyincaAuthError);
  await assert.rejects(mk(503).submitClip({ ...r, idempotencyKey: "k" }), OyincaTransientError);
  await assert.rejects(mk(422).submitClip({ ...r, idempotencyKey: "k" }), /422/);
});
