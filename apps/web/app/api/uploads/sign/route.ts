import { NextResponse } from "next/server";
import { currentWorkspace } from "@/lib/workspace";
import { signedPut, sourceKey } from "@/lib/storage/r2";
import { parseSettings } from "@/lib/worker/job";

const ALLOWED = ["video/mp4", "video/quicktime", "video/webm", "video/x-matroska"];
const MAX_BYTES = Number(process.env.MAX_UPLOAD_BYTES ?? 5 * 1024 ** 3);

export async function POST(request: Request) {
  const { supabase, userId, workspaceId, role } = await currentWorkspace();
  if (!["owner", "admin", "editor"].includes(role)) return NextResponse.json({ error: "Your role cannot upload." }, { status: 403 });

  const { title, contentType, size, settings } = await request.json();
  if (!ALLOWED.includes(contentType)) return NextResponse.json({ error: "Unsupported video type." }, { status: 400 });
  if (!Number.isFinite(size) || size <= 0 || size > MAX_BYTES) return NextResponse.json({ error: "File size is not allowed." }, { status: 400 });

  const { data: blocked } = await supabase.rpc("check_quota", { ws: workspaceId, kind: "storage", amount: size });
  if (blocked) return NextResponse.json({ error: `Plan limit: ${blocked}` }, { status: 402 });

  const { data: project, error } = await supabase
    .from("projects")
    .insert({ workspace_id: workspaceId, created_by: userId, title: String(title || "Untitled"), source_type: "upload", source_size_bytes: size, settings: parseSettings(settings) })
    .select("id")
    .single();
  if (error || !project) return NextResponse.json({ error: error?.message ?? "Could not create project" }, { status: 500 });

  const key = sourceKey(workspaceId, project.id);
  await supabase.from("projects").update({ source_path: key }).eq("id", project.id);
  try {
    return NextResponse.json({ projectId: project.id, uploadUrl: await signedPut(key, contentType) });
  } catch (e) {
    await supabase.from("projects").delete().eq("id", project.id);
    return NextResponse.json({ error: (e as Error).message }, { status: 503 });
  }
}
