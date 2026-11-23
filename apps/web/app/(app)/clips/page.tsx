import { Suspense } from "react";
import { currentWorkspace } from "@/lib/workspace";
import { signedGet } from "@/lib/storage/r2";
import { updateClip } from "./actions";

async function link(key: string | null) {
  if (!key) return null;
  try { return await signedGet(key, 600); } catch { return null; }
}

async function List() {
  const { supabase } = await currentWorkspace();
  const { data } = await supabase.from("clips").select("id, title, hook, category, engagement_score, selection_reason, storage_path, size_bytes, start_seconds, end_seconds, needs_manual_crop").order("created_at", { ascending: false }).limit(100);
  if (!data?.length) return <p className="text-sm text-black/60">No clips yet.</p>;
  const urls = await Promise.all(data.map((c) => link(c.storage_path)));
  return (
    <ul className="flex flex-col gap-4">
      {data.map((c, i) => (
        <li key={c.id} className="rounded-lg border p-4 text-sm">
          <form action={updateClip} className="flex flex-col gap-2">
            <input type="hidden" name="id" value={c.id} />
            <input name="title" defaultValue={c.title ?? ""} className="rounded border p-1.5 font-medium" aria-label="Title" />
            <input name="hook" defaultValue={c.hook ?? ""} className="rounded border p-1.5" aria-label="Hook" />
            <p className="text-black/60">
              {Math.round(c.end_seconds - c.start_seconds)}s · {c.category || "uncategorised"} · estimated engagement {c.engagement_score ?? "n/a"} (an estimate, not a prediction)
              {c.size_bytes ? ` · ${(c.size_bytes / 1048576).toFixed(1)} MB` : ""}
            </p>
            {c.selection_reason && <p className="text-black/60">{c.selection_reason}</p>}
            {c.needs_manual_crop && <p className="text-amber-700">Speaker tracking was uncertain; the crop is centred. Check the framing.</p>}
            <div className="flex items-center gap-3">
              <button className="rounded border px-2 py-1">Save text</button>
              {urls[i] && <a href={urls[i]!} className="underline" download>Download MP4</a>}
            </div>
          </form>
          {urls[i] && <video src={urls[i]!} controls preload="metadata" className="mt-3 max-h-96 rounded" />}
        </li>
      ))}
    </ul>
  );
}

export default function Page() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Generated Clips</h1>
      <Suspense fallback={<p className="text-sm text-black/60">Loading...</p>}><List /></Suspense>
    </div>
  );
}
