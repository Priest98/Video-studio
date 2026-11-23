import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";

async function count(table: "projects" | "clips" | "oyinca_connections") {
  const supabase = await createClient();
  const { count } = await supabase.from(table).select("*", { count: "exact", head: true });
  return count ?? 0;
}

async function DashboardContent() {
  const supabase = await createClient();
  const [projects, clips, connections, usage, recent] = await Promise.all([
    count("projects"),
    count("clips"),
    count("oyinca_connections"),
    supabase.from("usage_events").select("kind, quantity"),
    supabase.from("projects").select("id, title, status, created_at").order("created_at", { ascending: false }).limit(5),
  ]);

  const total = (kind: string) =>
    (usage.data ?? []).filter((u) => u.kind === kind).reduce((sum, u) => sum + Number(u.quantity), 0);

  const stats = [
    ["Projects", projects],
    ["Clips generated", clips],
    ["Processing minutes", Math.round(total("processing_minutes"))],
    ["Storage used (MB)", Math.round(total("storage_bytes") / 1_048_576)],
    ["Oyinca connections", connections],
  ];

  return (
    <>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        {stats.map(([label, value]) => (
          <div key={label} className="rounded-lg border p-4">
            <p className="text-sm text-black/60">{label}</p>
            <p className="text-2xl font-semibold">{value}</p>
          </div>
        ))}
      </div>
      <section>
        <h2 className="mb-3 font-medium">Recent projects</h2>
        {recent.data?.length ? (
          <ul className="divide-y rounded-lg border">
            {recent.data.map((p) => (
              <li key={p.id} className="flex justify-between p-3 text-sm">
                <span>{p.title}</span>
                <span className="text-black/60">{p.status}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-black/60">No projects yet.</p>
        )}
      </section>
    </>
  );
}

export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <Suspense fallback={<p className="text-sm text-black/60">Loading...</p>}>
        <DashboardContent />
      </Suspense>
    </div>
  );
}
