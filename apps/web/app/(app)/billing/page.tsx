import { Suspense } from "react";
import { currentWorkspace } from "@/lib/workspace";
import Upgrade from "./upgrade";

async function Usage() {
  const { supabase, workspaceId } = await currentWorkspace();
  const [{ data: ws }, { data: usage }] = await Promise.all([
    supabase.from("workspaces").select("plan").eq("id", workspaceId).single(),
    supabase.rpc("workspace_usage", { ws: workspaceId }),
  ]);
  const { data: lim } = await supabase.from("plan_limits").select("*").eq("plan", ws?.plan ?? "free").single();
  const u = usage?.[0];
  if (!u || !lim) return <p className="text-sm">Usage is unavailable.</p>;
  const rows = [
    ["Processing minutes this month", Math.round(u.processing_minutes), lim.max_processing_minutes_month],
    ["Clips this month", u.clips_this_month, lim.max_clips_month],
    ["Storage (MB)", Math.round(Number(u.storage_bytes) / 1048576), Math.round(lim.max_storage_bytes / 1048576)],
    ["Oyinca connections", u.connections, lim.max_oyinca_connections],
  ] as const;
  return (
    <>
      <p className="text-sm">Video Studio is free for now. Limits are generous but not unlimited.</p>
      {process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_PRO ? <Upgrade /> : null}
      <table className="w-full max-w-xl text-sm">
        <tbody>{rows.map(([label, used, max]) => (
          <tr key={label} className="border-t"><td className="py-2">{label}</td><td className="text-right">{used} / {max}</td></tr>
        ))}</tbody>
      </table>
    </>
  );
}

export default function Page() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Usage</h1>
      <Suspense fallback={<p className="text-sm text-black/60">Loading...</p>}><Usage /></Suspense>
    </div>
  );
}
