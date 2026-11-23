import { NextResponse } from "next/server";
import { currentWorkspace } from "@/lib/workspace";
import { signedGet } from "@/lib/storage/r2";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { supabase, workspaceId } = await currentWorkspace();
  const { data: project } = await supabase.from("projects").select("id, source_path, source_size_bytes, status, settings").eq("id", id).eq("workspace_id", workspaceId).single();
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (project.status !== "queued") return NextResponse.json({ error: "Already started" }, { status: 409 });

  const workerUrl = process.env.WORKER_URL, token = process.env.WORKER_TOKEN;
  if (!workerUrl || !token) return NextResponse.json({ error: "Media worker is not configured." }, { status: 503 });

  const body = await request.json().catch(() => ({}));
  const minutes = Number(body.durationMinutes ?? 0);
  const { data: blocked } = await supabase.rpc("check_quota", { ws: workspaceId, kind: "processing", amount: minutes });
  if (blocked) return NextResponse.json({ error: `Plan limit: ${blocked}` }, { status: 402 });

  const res = await fetch(`${workerUrl}/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ source_url: await signedGet(project.source_path!), ...(project.settings as object) }),
  });
  if (!res.ok) return NextResponse.json({ error: "Worker rejected the job." }, { status: 502 });
  const job = await res.json();
  await supabase.from("projects").update({ status: "processing", settings: { ...(project.settings as object), jobId: job.id } }).eq("id", id);
  return NextResponse.json({ jobId: job.id });
}
