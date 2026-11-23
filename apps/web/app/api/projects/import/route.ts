import { NextResponse } from "next/server";
import { currentWorkspace } from "@/lib/workspace";
import { parseSettings } from "@/lib/worker/job";

const HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "twitch.tv", "www.twitch.tv", "clips.twitch.tv"]);

export async function POST(request: Request) {
  const { supabase, userId, workspaceId, role } = await currentWorkspace();
  if (!["owner", "admin", "editor"].includes(role)) return NextResponse.json({ error: "Your role cannot create projects." }, { status: 403 });
  const { url, title, rightsConfirmed, settings } = await request.json();

  if (rightsConfirmed !== true) return NextResponse.json({ error: "Confirm you have the rights to use this video." }, { status: 400 });
  let parsed: URL;
  try { parsed = new URL(String(url)); } catch { return NextResponse.json({ error: "Invalid link." }, { status: 400 }); }
  if (parsed.protocol !== "https:" || !HOSTS.has(parsed.hostname))
    return NextResponse.json({ error: "Only YouTube and Twitch links are supported. Upload the file instead." }, { status: 400 });

  const { data: blocked } = await supabase.rpc("check_quota", { ws: workspaceId, kind: "processing", amount: 0 });
  if (blocked) return NextResponse.json({ error: `Plan limit: ${blocked}` }, { status: 402 });

  const { data: project, error } = await supabase.from("projects").insert({
    workspace_id: workspaceId, created_by: userId, title: String(title || parsed.hostname), source_type: "youtube", source_url: parsed.toString(),
    settings: { ...parseSettings(settings), rights_confirmed: true },
  }).select("id").single();
  if (error || !project) return NextResponse.json({ error: error?.message ?? "Could not create project" }, { status: 500 });
  return NextResponse.json({ projectId: project.id });
}
