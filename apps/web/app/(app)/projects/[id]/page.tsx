import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { currentWorkspace } from "@/lib/workspace";
import { signedGet } from "@/lib/storage/r2";
import { statusLabel } from "@/lib/status";
import { Download, Plus, Send } from "lucide-react";
import { AutoRefresh, Progress, StartButton } from "./live";

async function url(key: string | null) {
  if (!key) return null;
  try { return await signedGet(key, 3600); } catch { return null; }
}

async function Project({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, workspaceId } = await currentWorkspace();
  const { data: p } = await supabase.from("projects").select("id, title, status, error, settings").eq("id", id).eq("workspace_id", workspaceId).maybeSingle();
  if (!p) notFound();
  const s = statusLabel(p.status);

  const head = (
    <div className="flex flex-col gap-1">
      <h1 className="text-[clamp(26px,6vw,32px)] font-semibold leading-tight break-words">{p.title}</h1>
      <p className={`font-medium ${s.tone}`}>{s.text}</p>
    </div>
  );

  if (p.status === "processing") {
    const { data: early } = await supabase.from("clips").select("id, title, storage_path").eq("project_id", id).eq("workspace_id", workspaceId).order("start_seconds");
    const earlyUrls = await Promise.all((early ?? []).map((c) => url(c.storage_path)));
    return (
      <div className="flex max-w-[560px] flex-col gap-6">
        <AutoRefresh />
        {head}
        <Progress id={p.id} clipCount={(p.settings as { selection?: { clip_count?: number } } | null)?.selection?.clip_count ?? 3} ready={early?.length ?? 0} />
        {(early?.length ?? 0) > 0 && (
          <div className="flex flex-col gap-4">
            <p className="font-medium">Ready to watch now</p>
            <ul className="grid grid-cols-2 gap-4">
              {(early ?? []).map((c, i) => earlyUrls[i] && (
                <li key={c.id} className="flex flex-col gap-2">
                  <video src={earlyUrls[i]!} controls preload="metadata" playsInline className="aspect-[9/16] w-full rounded-2xl bg-[#11141c] object-contain" />
                  <p className="text-[15px] font-medium">{c.title || `Clip ${i + 1}`}</p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }
  if (p.status === "queued") {
    return (
      <div className="flex max-w-[560px] flex-col gap-6">
        {head}
        <p className="text-ink-2">This video has not started yet.</p>
        <StartButton id={p.id} label="Start now" />
      </div>
    );
  }
  if (p.status !== "ready") {
    return (
      <div className="flex max-w-[560px] flex-col gap-6">
        {head}
        {p.error && <p className="text-ink-2">{p.error}</p>}
        <Link href="/" className="btn btn-primary w-fit">Try another video</Link>
      </div>
    );
  }

  const { data: clips } = await supabase.from("clips").select("id, title, storage_path, needs_manual_crop").eq("project_id", id).eq("workspace_id", workspaceId).order("start_seconds");
  const urls = await Promise.all((clips ?? []).map((c) => url(c.storage_path)));

  return (
    <div className="flex flex-col gap-8">
      {head}
      <div className="flex flex-col gap-3 sm:flex-row">
        <Link href={`/distribution?project=${p.id}`} className="btn btn-primary"><Send aria-hidden size={18} strokeWidth={1.5} />Send to Oyinca</Link>
        <Link href="/" className="btn btn-quiet"><Plus aria-hidden size={18} strokeWidth={1.5} />Make more clips</Link>
      </div>
      <ul className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
        {(clips ?? []).map((c, i) => (
          <li key={c.id} className="rise flex flex-col gap-3" style={{ "--i": i } as React.CSSProperties}>
            {urls[i] ? (
              <video src={urls[i]!} controls preload="metadata" playsInline className="aspect-[9/16] max-h-[70vh] w-full rounded-2xl bg-[#11141c] object-contain shadow-[0_18px_32px_-14px_rgba(10,25,49,0.4)]" />
            ) : (
              <p className="rounded-2xl bg-sunken p-6 text-ink-2">This clip is not ready to play yet.</p>
            )}
            <div className="flex items-center justify-between gap-3">
              <p className="min-w-0 font-medium">{c.title || `Clip ${i + 1}`}</p>
              {urls[i] && <a href={urls[i]!} download className="btn btn-quiet shrink-0"><Download aria-hidden size={18} strokeWidth={1.5} />Download</a>}
            </div>
            {c.needs_manual_crop && <p className="text-[15px] text-ink-2">The speaker was hard to follow, so this clip is centered. Check it before you send it.</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={<p className="text-muted">Loading...</p>}><Project params={params} /></Suspense>;
}
