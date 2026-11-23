"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";

/** Refreshes the page while work is in progress so the result appears on its own. */
export function AutoRefresh() {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(t);
  }, [router]);
  return null;
}

/** What the worker is doing right now, in plain words. The worker reports the last step it finished. */
function activity(stage: string | null): string {
  switch (stage) {
    case "analyse": return "Listening to every word";
    case "transcribe": return "Picking the best moments";
    case "select":
    case "render": return "Cutting and captioning your clips";
    default: return "Getting your video";
  }
}

/** Live progress. One slot per clip fills in as each clip is finished. */
export function Progress({ id, clipCount }: { id: string; clipCount: number }) {
  const [stage, setStage] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const r = await fetch(`/api/projects/${id}/progress`, { cache: "no-store" });
        if (!r.ok || !alive) return;
        const j = await r.json();
        setStage(j.stage ?? null);
        setProgress(typeof j.progress === "number" ? j.progress : 0);
      } catch { /* try again on the next tick */ }
    }
    tick();
    const t = setInterval(tick, 3000);
    return () => { alive = false; clearInterval(t); };
  }, [id]);

  const pct = Math.min(99, Math.round(progress * 100));
  // The render stage covers the last 55% of the job; each clip is an equal share of it.
  const made = stage === "render" || stage === "select" ? Math.max(0, ((progress - 0.45) / 0.55) * clipCount) : 0;

  return (
    <div className="flex flex-col gap-6" role="status" aria-live="polite">
      <div className="flex items-end justify-between gap-4">
        <p className="text-[18px] font-medium">{activity(stage)}</p>
        <p className="font-display text-[44px] font-medium leading-none tabular-nums">{pct}%</p>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-sunken" aria-hidden>
        <div className="h-full rounded-full bg-steel transition-[width] duration-500 ease-out" style={{ width: `${Math.max(pct, 3)}%` }} />
      </div>
      <ul className="flex gap-3" aria-label="Clips">
        {Array.from({ length: clipCount }, (_, i) => {
          const done = made >= i + 1;
          const part = done ? 1 : Math.max(0, Math.min(1, made - i));
          return (
            <li key={i} className="relative flex aspect-[9/16] w-[72px] items-center justify-center overflow-hidden rounded-xl border border-control bg-surface sm:w-24">
              <span className="absolute inset-x-0 bottom-0 bg-ink transition-[height] duration-500 ease-out" style={{ height: `${part * 100}%` }} />
              {done ? <Check aria-label={`Clip ${i + 1} is done`} size={20} strokeWidth={2} className="relative text-canvas" /> : <span className="relative text-[14px] font-medium tabular-nums text-muted">{i + 1}</span>}
            </li>
          );
        })}
      </ul>
      <p className="text-ink-2">You can leave this page and come back. Longer videos take longer.</p>
    </div>
  );
}

/** Starts a project that never reached the worker. */
export function StartButton({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function start() {
    setBusy(true);
    setError("");
    const r = await fetch(`/api/projects/${id}/start`, { method: "POST", body: JSON.stringify({}) });
    if (r.ok) { router.refresh(); return; }
    setError((await r.json().catch(() => ({}))).error ?? "Could not start. Try again.");
    setBusy(false);
  }
  return (
    <div className="flex flex-col gap-3">
      <button onClick={start} disabled={busy} className="btn btn-primary w-fit">{busy ? "Starting..." : label}</button>
      {error && <p role="alert" className="text-[15px] font-medium text-danger">{error}</p>}
    </div>
  );
}
