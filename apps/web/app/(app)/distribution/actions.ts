"use server";

import { currentWorkspace } from "@/lib/workspace";
import { scheduleSequences, type Assignments } from "@/lib/distribution/shuffle";
import { adminClient } from "@/lib/supabase/admin";
import { decrypt } from "@/lib/crypto";
import { signedGet } from "@/lib/storage/r2";
import { HttpOyincaClient } from "@/lib/oyinca/client";
import { idempotencyKey, processBatch, type TransferRow, type TransferStatus, type TransferStore } from "@/lib/oyinca/transfer";

export interface SavePlanInput {
  name: string;
  projectId?: string;
  seed: number;
  intervalMinutes: number;
  minGapMinutes: number;
  startAt: string;
  sequences: Assignments; // accountId -> ordered clip ids
}

export async function savePlan(input: SavePlanInput): Promise<{ id?: string; error?: string }> {
  const { supabase, userId, workspaceId, role } = await currentWorkspace();
  if (!["owner", "admin", "editor"].includes(role)) return { error: "Your role cannot create plans." };
  if (!input.name.trim()) return { error: "Name the plan first." };

  // Recompute times on the server so a client cannot save a schedule that breaks the cross-account gap.
  let schedule;
  try {
    schedule = scheduleSequences(input.sequences, {
      start: new Date(input.startAt), intervalMinutes: input.intervalMinutes, minCrossAccountGapMinutes: input.minGapMinutes,
    });
  } catch (e) {
    return { error: (e as Error).message };
  }

  const { data: plan, error } = await supabase
    .from("distribution_plans")
    .insert({
      workspace_id: workspaceId, created_by: userId, project_id: input.projectId ?? null, name: input.name, seed: input.seed,
      interval_minutes: input.intervalMinutes, min_gap_minutes: input.minGapMinutes, start_at: input.startAt, status: "saved",
    })
    .select("id")
    .single();
  if (error || !plan) return { error: error?.message ?? "Could not save the plan." };

  const position = new Map<string, number>();
  const items = schedule.map((s) => {
    const pos = position.get(s.accountId) ?? 0;
    position.set(s.accountId, pos + 1);
    return { plan_id: plan.id, workspace_id: workspaceId, clip_id: s.clipId, account_id: s.accountId, position: pos, scheduled_at: s.at.toISOString() };
  });
  const { error: itemsError } = await supabase.from("distribution_items").insert(items);
  if (itemsError) {
    await supabase.from("distribution_plans").delete().eq("id", plan.id);
    return { error: itemsError.message };
  }
  return { id: plan.id };
}

// ---------------------------------------------------------------------------------------------
// Send a saved plan into Oyinca's approval queues. Submit-only: nothing is published from here.
// ---------------------------------------------------------------------------------------------

export async function sendPlan(planId: string): Promise<{ results?: Record<TransferStatus, number>; error?: string }> {
  const { workspaceId, role } = await currentWorkspace();
  if (!["owner", "admin", "editor"].includes(role)) return { error: "Your role cannot send plans." };
  const base = process.env.OYINCA_API_URL;
  if (!base) return { error: "Oyinca is not configured (OYINCA_API_URL)." };

  const db = adminClient();
  // Every query is pinned to the caller's workspace: the plan id alone is never trusted.
  const { data: plan } = await db.from("distribution_plans").select("id").eq("id", planId).eq("workspace_id", workspaceId).maybeSingle();
  if (!plan) return { error: "Plan not found." };

  const { data: items } = await db.from("distribution_items")
    .select("id, clip_id, scheduled_at, account:oyinca_accounts(connection_id, external_brand_id, external_account_id, can_submit), clip:clips(title, description, storage_path, size_bytes)")
    .eq("plan_id", planId).eq("workspace_id", workspaceId).order("position");
  if (!items?.length) return { error: "This plan has no items." };

  // Create transfer rows once. The unique item_id makes this safe to call repeatedly.
  await db.from("transfers").upsert(
    items.map((i) => ({ workspace_id: workspaceId, item_id: i.id, idempotency_key: idempotencyKey(planId, i.id) })),
    { onConflict: "item_id", ignoreDuplicates: true },
  );
  const { data: rows } = await db.from("transfers").select("*").eq("workspace_id", workspaceId).in("item_id", items.map((i) => i.id));
  const byItem = new Map(items.map((i) => [i.id, i]));

  const store: TransferStore = {
    async update(id, patch) {
      await db.from("transfers").update({
        status: patch.status, attempts: patch.attempts, oyinca_asset_id: patch.oyincaAssetId, last_error: patch.lastError ?? null,
        updated_at: new Date().toISOString(),
      }).eq("id", id);
    },
    async markConnectionExpired(itemId) {
      const connId = (byItem.get(itemId)?.account as unknown as { connection_id: string } | undefined)?.connection_id;
      if (connId) await db.from("oyinca_connections").update({ status: "expired" }).eq("id", connId).eq("workspace_id", workspaceId);
    },
  };

  const clients = new Map<string, HttpOyincaClient>();
  async function clientFor(connectionId: string) {
    const hit = clients.get(connectionId);
    if (hit) return hit;
    const { data } = await db.from("oyinca_credentials").select("access_token_encrypted").eq("connection_id", connectionId).single();
    if (!data) throw new Error("Connection has no stored credentials.");
    const token = decrypt(data.access_token_encrypted);
    const c = new HttpOyincaClient(base!, async () => token);
    clients.set(connectionId, c);
    return c;
  }

  const todo: TransferRow[] = (rows ?? []).map((r) => ({
    id: r.id, itemId: r.item_id, idempotencyKey: r.idempotency_key, status: r.status, attempts: r.attempts,
    oyincaAssetId: r.oyinca_asset_id ?? undefined, lastError: r.last_error ?? undefined,
  }));

  const counts = { pending: 0, uploading: 0, transferred: 0, awaiting_approval: 0, failed: 0, cancelled: 0 } as Record<TransferStatus, number>;
  // One client per connection; group so each connection's items use its own token.
  const groups = new Map<string, TransferRow[]>();
  for (const r of todo) {
    const acc = byItem.get(r.itemId)?.account as unknown as { connection_id: string } | undefined;
    const key = acc?.connection_id ?? "";
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }

  for (const [connectionId, group] of groups) {
    let client: HttpOyincaClient;
    try { client = await clientFor(connectionId); }
    catch (e) {
      for (const r of group) await store.update(r.id, { status: "failed", lastError: (e as Error).message });
      counts.failed += group.length;
      continue;
    }
    const out = await processBatch(store, client, group, async (row) => {
      const item = byItem.get(row.itemId)!;
      const acc = item.account as unknown as { external_brand_id: string; external_account_id: string; can_submit: boolean };
      const clip = item.clip as unknown as { title: string | null; description: string | null; storage_path: string | null; size_bytes: number | null };
      if (!acc.can_submit) throw new Error("This Oyinca account does not allow submissions.");
      if (!clip.storage_path) throw new Error("The clip has not finished rendering.");
      return {
        idempotencyKey: row.idempotencyKey, brandId: acc.external_brand_id, accountId: acc.external_account_id,
        videoUrl: await signedGet(clip.storage_path, 900), filename: `${(clip.title ?? "clip").replace(/[^\w-]+/g, "-").slice(0, 60)}.mp4`,
        mimeType: "video/mp4" as const, sizeBytes: clip.size_bytes ?? 0, title: clip.title ?? undefined,
        caption: clip.description ?? undefined, suggestedPublishAt: item.scheduled_at ?? undefined,
      };
    });
    for (const s of Object.values(out)) counts[s] += 1;
  }

  await db.from("distribution_plans").update({ status: "sent" }).eq("id", planId).eq("workspace_id", workspaceId);
  return { results: counts };
}
