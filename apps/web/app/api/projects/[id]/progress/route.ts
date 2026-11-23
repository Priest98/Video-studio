import { NextResponse } from "next/server";
import { currentWorkspace } from "@/lib/workspace";
import { workerAddress } from "@/lib/worker/address";

/** Live progress of a running project, read from the media worker. */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { supabase, workspaceId } = await currentWorkspace();
  const { data: project } = await supabase.from("projects").select("status, settings").eq("id", id).eq("workspace_id", workspaceId).maybeSingle();
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const jobId = (project.settings as { jobId?: string } | null)?.jobId;
  const token = process.env.WORKER_TOKEN;
  const base = await workerAddress();
  if (project.status !== "processing" || !jobId || !token || !base) return NextResponse.json({ status: project.status, stage: null, progress: 0 });
  try {
    const r = await fetch(`${base}/jobs/${jobId}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8_000), cache: "no-store" });
    if (!r.ok) return NextResponse.json({ status: project.status, stage: null, progress: 0 });
    const j = await r.json();
    return NextResponse.json({ status: project.status, stage: j.stage ?? null, progress: typeof j.progress === "number" ? j.progress : 0 });
  } catch {
    return NextResponse.json({ status: project.status, stage: null, progress: 0 });
  }
}
