import { Suspense } from "react";
import { currentWorkspace } from "@/lib/workspace";
import ConnectForm from "./connect-form";
import { disconnectOyinca } from "./actions";

async function Connections() {
  const { supabase } = await currentWorkspace();
  const [conns, accounts] = await Promise.all([
    supabase.from("oyinca_connections").select("id, label, status"),
    supabase.from("oyinca_accounts").select("id, connection_id, platform, handle"),
  ]);
  if (!conns.data?.length) return null;
  return (
    <ul className="flex flex-col divide-y divide-line border-y border-line">
      {conns.data.map((c) => (
        <li key={c.id} className="flex flex-col gap-2 py-4">
          <div className="flex items-center justify-between gap-4">
            <p className="min-w-0 truncate font-medium">{c.label}{c.status === "expired" && <span className="ml-2 text-danger">Reconnect needed</span>}</p>
            <form action={disconnectOyinca}>
              <input type="hidden" name="id" value={c.id} />
              <button className="rounded-lg px-3 py-2 text-[15px] font-medium text-ink-2 underline underline-offset-4">Disconnect</button>
            </form>
          </div>
          <p className="text-[15px] text-ink-2">
            {(accounts.data ?? []).filter((a) => a.connection_id === c.id).map((a) => `${a.platform.toLowerCase()} ${a.handle ?? ""}`.trim()).join(", ") || "No accounts found"}
          </p>
        </li>
      ))}
    </ul>
  );
}

export default function Page() {
  return (
    <div className="flex max-w-[560px] flex-col gap-8">
      <h1 className="text-[clamp(26px,6vw,32px)] font-semibold leading-tight">Connect Oyinca</h1>
      <ConnectForm />
      <Suspense fallback={<p className="text-muted">Loading...</p>}><Connections /></Suspense>
    </div>
  );
}
