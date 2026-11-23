"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardPaste, Link2, Scissors, Upload } from "lucide-react";
import { CAPTION_STYLES, Frame } from "./caption-styles";

export default function CreateForm() {
  const router = useRouter();
  const [useFile, setUseFile] = useState(false);
  const [link, setLink] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [rights, setRights] = useState(false);
  const [style, setStyle] = useState("bold_animated");
  const [count, setCount] = useState(3);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const settings = () => ({
    caption_style: style, caption_mode: "word", quality: "standard",
    selection: { clip_count: count, min_seconds: 30, max_seconds: 60, categories: [] as string[] },
  });

  async function paste() {
    try { setLink(await navigator.clipboard.readText()); } catch { setError("Paste the link into the box yourself."); }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      let projectId: string;
      if (!useFile) {
        const r = await fetch("/api/projects/import", { method: "POST", body: JSON.stringify({ url: link.trim(), rightsConfirmed: rights, settings: settings() }) });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error);
        projectId = j.projectId;
      } else {
        if (!file) return;
        const sign = await fetch("/api/uploads/sign", { method: "POST", body: JSON.stringify({ title: file.name, contentType: file.type, size: file.size, settings: settings() }) });
        const signed = await sign.json();
        if (!sign.ok) throw new Error(signed.error);
        const put = await fetch(signed.uploadUrl, { method: "PUT", body: file, headers: { "content-type": file.type } });
        if (!put.ok) throw new Error("The upload did not finish. Try again.");
        projectId = signed.projectId;
      }
      // If the worker is not reachable the project stays queued; its page offers a retry.
      await fetch(`/api/projects/${projectId}/start`, { method: "POST", body: JSON.stringify({}) });
      router.push(`/projects/${projectId}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const ready = useFile ? Boolean(file) : link.trim().length > 0 && rights;

  return (
    <form onSubmit={submit} className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        {useFile ? (
          <>
            <label htmlFor="file" className="font-semibold">Your video</label>
            <input id="file" type="file" accept="video/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="input py-3" />
          </>
        ) : (
          <>
            <label htmlFor="link" className="font-semibold">Video link</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Link2 aria-hidden size={18} strokeWidth={1.5} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
                <input id="link" type="url" inputMode="url" autoComplete="off" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://youtube.com/watch?v=..." className="input pl-11" />
              </div>
              <button type="button" onClick={paste} className="btn btn-quiet shrink-0"><ClipboardPaste aria-hidden size={18} strokeWidth={1.5} />Paste</button>
            </div>
            <label className="flex items-start gap-3 text-[15px] text-ink-2">
              <input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} className="mt-1 size-5 accent-[#0a1931]" />
              I have the right to use this video.
            </label>
          </>
        )}
        <button type="button" onClick={() => { setUseFile(!useFile); setError(""); }} className="-ml-1 w-fit rounded-lg px-1 py-2 text-[15px] font-medium text-steel underline underline-offset-4">
          {useFile ? "Use a link instead" : <span className="inline-flex items-center gap-1.5"><Upload aria-hidden size={16} strokeWidth={1.5} />Upload a video instead</span>}
        </button>
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-3 font-semibold">Caption style</legend>
        <div className="grid grid-cols-4 gap-2 sm:gap-3">
          {CAPTION_STYLES.map((s) => (
            <label key={s.id} className="group flex cursor-pointer flex-col gap-2">
              <input type="radio" name="style" value={s.id} checked={style === s.id} onChange={() => setStyle(s.id)} className="peer sr-only" />
              <span className="rounded-xl border-2 border-transparent p-1 transition-colors peer-checked:border-ink peer-focus-visible:outline peer-focus-visible:outline-[3px] peer-focus-visible:outline-offset-2 peer-focus-visible:outline-steel">
                <span className="block aspect-[9/16] w-full overflow-hidden rounded-lg"><Frame s={s} scale={0.8} /></span>
              </span>
              <span className={`text-center text-[14px] ${style === s.id ? "font-semibold" : "text-ink-2"}`}>{s.name}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-3 font-semibold">How many clips</legend>
        <div className="grid grid-cols-2 gap-2">
          {[{ n: 3, name: "3 clips", hint: "Faster" }, { n: 5, name: "5 clips", hint: "More to pick from" }].map((o) => (
            <label key={o.n} className="cursor-pointer">
              <input type="radio" name="count" checked={count === o.n} onChange={() => setCount(o.n)} className="peer sr-only" />
              <span className="flex min-h-14 flex-col justify-center rounded-xl border border-control bg-surface px-4 py-2 transition-colors peer-checked:border-ink peer-checked:bg-sunken peer-focus-visible:outline peer-focus-visible:outline-[3px] peer-focus-visible:outline-offset-2 peer-focus-visible:outline-steel">
                <span className="font-semibold">{o.name}</span>
                <span className="text-[14px] text-ink-2">{o.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-3">
        <button disabled={!ready || busy} className="btn btn-primary w-full"><Scissors aria-hidden size={18} strokeWidth={1.5} />{busy ? "Starting..." : "Make my clips"}</button>
        {error && <p role="alert" className="text-[15px] font-medium text-danger">{error}</p>}
      </div>
    </form>
  );
}
