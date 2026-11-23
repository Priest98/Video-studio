import { Suspense } from "react";
import Link from "next/link";
import { currentWorkspace } from "@/lib/workspace";

async function List() {
  const { supabase } = await currentWorkspace();
  const { data } = await supabase.from("projects").select("id, title, status, created_at, error").order("created_at", { ascending: false });
  if (!data?.length) return <p className="text-sm text-black/60">No projects yet. <Link href="/projects/new" className="underline">Create one</Link>.</p>;
  return (
    <ul className="divide-y rounded-lg border">
      {data.map((p) => (
        <li key={p.id} className="flex justify-between p-3 text-sm">
          <span>{p.title}</span>
          <span className="text-black/60">{p.status}{p.error ? `: ${p.error}` : ""}</span>
        </li>
      ))}
    </ul>
  );
}

export default function Page() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">My Projects</h1>
      <Suspense fallback={<p className="text-sm text-black/60">Loading...</p>}><List /></Suspense>
    </div>
  );
}
