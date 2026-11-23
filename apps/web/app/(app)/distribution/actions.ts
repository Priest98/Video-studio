"use server";

import { currentWorkspace } from "@/lib/workspace";
import { scheduleSequences, type Assignments } from "@/lib/distribution/shuffle";

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
