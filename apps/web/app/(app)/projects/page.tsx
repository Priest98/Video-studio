import { Suspense } from "react";
import Link from "next/link";
import { currentWorkspace } from "@/lib/workspace";
import { statusLabel } from "@/lib/status";

async function List() {
  const { supabase } = await currentWorkspace();
  const { data } = await supabase.from("projects").select("id, title, status, created_at").order("created_at", { ascending: false }).limit(50);
  if (!data?.length) {
    return (
      <div className="flex flex-col items-start gap-4">
        <p className="text-ink-2">You have no videos yet.</p>
        <Link href="/" className="btn btn-primary">Make my first clips</Link>
      </div>
    );
  }
  return (
    <ul className="flex flex-col divide-y divide-line border-y border-line">
      {data.map((p) => {
        const s = statusLabel(p.status);
        return (
          <li key={p.id}>
            <Link href={`/projects/${p.id}`} className="flex min-h-14 items-center justify-between gap-4 py-3 hover:bg-sunken/60">
              <span className="min-w-0 truncate font-medium">{p.title}</span>
              <span className={`shrink-0 text-[14px] font-medium ${s.tone}`}>{s.text}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export default function Page() {
  return (
    <div className="flex max-w-[560px] flex-col gap-6">
      <h1 className="text-[clamp(26px,6vw,32px)] font-semibold leading-tight">My clips</h1>
      <Suspense fallback={<p className="text-muted">Loading...</p>}><List /></Suspense>
    </div>
  );
}
