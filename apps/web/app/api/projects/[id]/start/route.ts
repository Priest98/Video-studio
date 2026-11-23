import { NextResponse } from "next/server";
import { currentWorkspace } from "@/lib/workspace";
import { signedGet } from "@/lib/storage/r2";
import { workerJob } from "@/lib/worker/job";
import { workerAddress } from "@/lib/worker/address";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { supabase, workspaceId } = await currentWorkspace();
  const { data: project } = await supabase.from("projects").select("id, workspace_id, source_type, source_url, source_path, source_size_bytes, status, settings").eq("id", id).eq("workspace_id", workspaceId).single();
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (project.status !== "queued") return NextResponse.json({ error: "Already started" }, { status: 409 });

  const workerUrl = await workerAddress(), token = process.env.WORKER_TOKEN;
  if (!workerUrl || !token) return NextResponse.json({ error: "The media worker has not started yet. Start it, then try again." }, { status: 503 });

  const body = await request.json().catch(() => ({}));
  const minutes = Number(body.durationMinutes ?? 0);
  const { data: blocked } = await supabase.rpc("check_quota", { ws: workspaceId, kind: "processing", amount: minutes });
  if (blocked) return NextResponse.json({ error: `Plan limit: ${blocked}` }, { status: 402 });

  let res: Response;
  try {
    res = await fetch(`${workerUrl}/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(workerJob(
        project,
        project.source_type === "youtube"
          ? { import_url: project.source_url!, rights_confirmed: (project.settings as { rights_confirmed?: boolean })?.rights_confirmed === true }
          : { source_url: await signedGet(project.source_path!) },
        process.env.APP_URL ?? new URL(request.url).origin,
      )),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    // Project stays queued so it can be started again once the worker is reachable.
    return NextResponse.json({ error: "Could not reach the media worker. Check WORKER_URL and that the worker is running." }, { status: 503 });
  }
  if (!res.ok) return NextResponse.json({ error: "Worker rejected the job." }, { status: 502 });
  const job = await res.json();
  await supabase.from("projects").update({ status: "processing", settings: { ...(project.settings as object), jobId: job.id } }).eq("id", id);
  return NextResponse.json({ jobId: job.id });
}
