import { Suspense } from "react";
import { currentWorkspace } from "@/lib/workspace";
import Send from "./studio";

async function Content({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { project } = await searchParams;
  const { supabase, workspaceId } = await currentWorkspace();
  let q = supabase.from("clips").select("id").eq("workspace_id", workspaceId).not("storage_path", "is", null).order("start_seconds");
  if (project) q = q.eq("project_id", project);
  const [clips, accounts] = await Promise.all([
    q.limit(50),
    supabase.from("oyinca_accounts").select("id, platform, handle").eq("workspace_id", workspaceId).eq("can_submit", true),
  ]);
  return <Send projectId={project} clipIds={(clips.data ?? []).map((c) => c.id)} accounts={accounts.data ?? []} />;
}

export default function Page({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  return (
    <div className="flex max-w-[560px] flex-col gap-6">
      <h1 className="text-[clamp(26px,6vw,32px)] font-semibold leading-tight">Send to Oyinca</h1>
      <Suspense fallback={<p className="text-muted">Loading...</p>}><Content searchParams={searchParams} /></Suspense>
    </div>
  );
}
