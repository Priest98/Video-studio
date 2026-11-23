import { Suspense } from "react";
import { currentWorkspace } from "@/lib/workspace";
import Studio from "./studio";

async function Content() {
  const { supabase } = await currentWorkspace();
  const [clips, accounts] = await Promise.all([
    supabase.from("clips").select("id, title").order("created_at", { ascending: false }).limit(200),
    supabase.from("oyinca_accounts").select("id, platform, handle").eq("can_submit", true),
  ]);
  return <Studio clips={clips.data ?? []} accounts={accounts.data ?? []} />;
}

export default function Page() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Distribution Studio</h1>
      <Suspense fallback={<p className="text-sm text-black/60">Loading...</p>}><Content /></Suspense>
    </div>
  );
}
