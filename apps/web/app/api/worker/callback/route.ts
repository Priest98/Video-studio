import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { adminClient } from "@/lib/supabase/admin";
import { verifyCallback } from "@/lib/worker/verify";

export async function POST(request: Request) {
  const raw = await request.text();
  if (!verifyCallback(process.env.CALLBACK_SECRET ?? "", request.headers.get("x-timestamp"), request.headers.get("x-signature"), raw))
    return NextResponse.json({ error: "bad signature" }, { status: 401 });

  const body = JSON.parse(raw);
  const db = adminClient();

  // The workspace in the payload must own the project; never trust the worker's tenant claim alone.
  const { data: project } = await db.from("projects").select("id, workspace_id, status, settings").eq("id", body.project_id).eq("workspace_id", body.workspace_id).single();
  if (!project) return NextResponse.json({ error: "unknown project" }, { status: 404 });

  const eventId = createHash("sha256").update(raw).digest("hex");
  const { error: dup } = await db.from("worker_events").insert({ id: eventId, workspace_id: project.workspace_id });
  if (dup) return NextResponse.json({ ok: true, duplicate: true }); // retried callback: already applied

  if (body.status !== "ready") {
    await db.from("projects").update({ status: body.status === "cancelled" ? "cancelled" : "failed", error: body.error ?? null }).eq("id", project.id);
    return NextResponse.json({ ok: true });
  }

  const style = (project.settings as { caption_style?: string } | null)?.caption_style ?? null;
  const rows = (body.clips as Record<string, unknown>[]).map((c) => ({
    workspace_id: project.workspace_id, project_id: project.id,
    start_seconds: c.start, end_seconds: c.end, title: c.title, description: c.description, transcript: c.transcript, hook: c.hook,
    category: c.category, engagement_score: c.engagement_score, selection_reason: c.reason, status: "ready",
    storage_path: c.storage_key, size_bytes: c.size_bytes, crf: c.crf, needs_manual_crop: c.needs_manual_crop, caption_style: style,
  }));
  if (rows.length) await db.from("clips").insert(rows);
  await db.from("projects").update({ status: "ready", duration_seconds: body.source_seconds }).eq("id", project.id);

  const usage = [{ workspace_id: project.workspace_id, project_id: project.id, kind: "processing_minutes", quantity: Number(body.source_seconds ?? 0) / 60 }];
  const chars = (body.clips as { voice_characters?: number; voice_cost_usd?: number }[]).reduce((a, c) => a + (c.voice_characters ?? 0), 0);
  if (chars) usage.push({ workspace_id: project.workspace_id, project_id: project.id, kind: "tts_characters", quantity: chars });
  await db.from("usage_events").insert(usage);
  return NextResponse.json({ ok: true });
}
