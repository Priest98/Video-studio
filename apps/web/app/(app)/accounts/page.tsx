import { Suspense } from "react";
import { currentWorkspace } from "@/lib/workspace";

async function Connections() {
  const { supabase } = await currentWorkspace();
  const [conns, accounts] = await Promise.all([
    supabase.from("oyinca_connections").select("id, label, status, permission_level"),
    supabase.from("oyinca_accounts").select("id, connection_id, platform, handle, can_submit"),
  ]);
  if (!conns.data?.length) return <p className="text-sm text-black/60">No Oyinca accounts connected.</p>;
  return (
    <div className="flex flex-col gap-4">
      {conns.data.map((c) => (
        <section key={c.id} className="rounded-lg border p-4 text-sm">
          <p className="font-medium">{c.label} <span className="text-black/60">({c.status}{c.permission_level ? `, ${c.permission_level}` : ""})</span></p>
          <ul className="mt-2 list-disc pl-5">
            {(accounts.data ?? []).filter((a) => a.connection_id === c.id).map((a) => (
              <li key={a.id}>{a.platform} {a.handle} {a.can_submit ? "" : "(view only)"}</li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export default function Page() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Connected Accounts</h1>
      <button disabled title="Needs Oyinca's partner API (see docs/oyinca-integration.md)" className="w-fit rounded border px-3 py-1.5 text-sm opacity-40">Connect Oyinca</button>
      <Suspense fallback={<p className="text-sm text-black/60">Loading...</p>}><Connections /></Suspense>
    </div>
  );
}
