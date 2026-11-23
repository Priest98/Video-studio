import { createHash } from "node:crypto";
import { OyincaAuthError, OyincaTransientError, type OyincaClient, type SubmitClipRequest } from "./client.ts";

export type TransferStatus = "pending" | "uploading" | "transferred" | "awaiting_approval" | "failed" | "cancelled";

export interface TransferRow {
  id: string;
  itemId: string;
  idempotencyKey: string;
  status: TransferStatus;
  attempts: number;
  oyincaAssetId?: string;
  lastError?: string;
}

export interface TransferStore {
  update(id: string, patch: Partial<TransferRow>): Promise<void>;
  markConnectionExpired(itemId: string): Promise<void>;
}

export const MAX_ATTEMPTS = 3;
const DONE: TransferStatus[] = ["transferred", "awaiting_approval", "cancelled"];

/** Stable per item: retries reuse it, so Oyinca can de-duplicate even if our own bookkeeping is lost. */
export function idempotencyKey(planId: string, itemId: string) {
  return createHash("sha256").update(`${planId}:${itemId}`).digest("hex");
}

/** Sends one item. Never throws: the outcome is written to the store so one failure cannot affect others. */
export async function processTransfer(
  store: TransferStore, client: OyincaClient, row: TransferRow, buildRequest: () => Promise<SubmitClipRequest>,
): Promise<TransferStatus> {
  if (DONE.includes(row.status)) return row.status; // already delivered or cancelled: never resubmit
  const attempts = row.attempts + 1;
  await store.update(row.id, { status: "uploading", attempts });
  try {
    const result = await client.submitClip({ ...(await buildRequest()), idempotencyKey: row.idempotencyKey });
    await store.update(row.id, { status: "awaiting_approval", oyincaAssetId: result.assetId, lastError: undefined });
    return "awaiting_approval";
  } catch (e) {
    const message = (e as Error).message;
    if (e instanceof OyincaAuthError) {
      await store.markConnectionExpired(row.itemId);
      await store.update(row.id, { status: "failed", lastError: message });
      return "failed";
    }
    if (e instanceof OyincaTransientError && attempts < MAX_ATTEMPTS) {
      await store.update(row.id, { status: "pending", lastError: message }); // picked up by the next sweep
      return "pending";
    }
    await store.update(row.id, { status: "failed", lastError: message });
    return "failed";
  }
}

export async function processBatch(
  store: TransferStore, client: OyincaClient, rows: TransferRow[],
  build: (row: TransferRow) => Promise<SubmitClipRequest>, concurrency = 3,
): Promise<Record<string, TransferStatus>> {
  const results: Record<string, TransferStatus> = {};
  let next = 0;
  const worker = async () => {
    while (next < rows.length) {
      const row = rows[next++];
      results[row.id] = await processTransfer(store, client, row, () => build(row));
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, worker));
  return results;
}
