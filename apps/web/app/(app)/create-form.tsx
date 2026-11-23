"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CSSProperties } from "react";

/** Each card previews the real caption look the worker will burn into the video. */
const STYLES: { id: string; name: string; text: CSSProperties; hi: string; box?: boolean }[] = [
  { id: "bold_animated", name: "Bold", hi: "#ffe500",
    text: { fontWeight: 800, textTransform: "uppercase", fontSize: 17, WebkitTextStroke: "3px #000", paintOrder: "stroke fill" } },
  { id: "minimal", name: "Simple", hi: "#ffffff",
    text: { fontWeight: 400, fontSize: 14, textShadow: "0 0 3px #000, 0 0 3px #000" } },
  { id: "cinematic", name: "Cinematic", hi: "#ffc040",
    text: { fontFamily: "Georgia, serif", fontWeight: 400, fontSize: 15, color: "#f0f0f0", textShadow: "0 2px 3px #000" } },
  { id: "clean_educational", name: "Boxed", hi: "#ffc800", box: true,
    text: { fontWeight: 700, fontSize: 14 } },
];

const SAMPLE = ["Watch", "how", "this", "looks"];

function Preview({ s }: { s: (typeof STYLES)[number] }) {
  const words = SAMPLE.map((w, i) => (
    <span key={w} style={{ color: i === 1 ? s.hi : s.text.color ?? "#fff" }}>{w}{i < SAMPLE.length - 1 ? " " : ""}</span>
  ));
  return (
    <div aria-hidden className="relative flex aspect-[9/16] w-full items-end justify-center overflow-hidden rounded-lg bg-[#1a1d26] pb-[28%]">
      <p
        className="max-w-[80%] text-center leading-tight text-white"
        style={{ ...s.text, ...(s.box ? { background: "rgba(0,0,0,0.72)", padding: "3px 6px", borderRadius: 3 } : {}) }}
      >
        {words}
      </p>
    </div>
  );
}

export default function CreateForm() {
  const router = useRouter();
  const [useFile, setUseFile] = useState(false);
  const [link, setLink] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [rights, setRights] = useState(false);
  const [style, setStyle] = useState("bold_animated");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const settings = () => ({
    caption_style: style, caption_mode: "word", quality: "standard",
    selection: { clip_count: 5, min_seconds: 30, max_seconds: 60, categories: [] as string[] },
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
              <input id="link" type="url" inputMode="url" autoComplete="off" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://youtube.com/watch?v=..." className="input" />
              <button type="button" onClick={paste} className="btn btn-quiet shrink-0">Paste</button>
            </div>
            <label className="flex items-start gap-3 text-[15px] text-ink-2">
              <input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} className="mt-1 size-5 accent-[#0a1931]" />
              I have the right to use this video.
            </label>
          </>
        )}
        <button type="button" onClick={() => { setUseFile(!useFile); setError(""); }} className="-ml-1 w-fit rounded-lg px-1 py-2 text-[15px] font-medium text-steel underline underline-offset-4">
          {useFile ? "Use a link instead" : "Upload a video instead"}
        </button>
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-3 font-semibold">Caption style</legend>
        <div className="grid grid-cols-4 gap-2 sm:gap-3">
          {STYLES.map((s) => (
            <label key={s.id} className="group flex cursor-pointer flex-col gap-2">
              <input type="radio" name="style" value={s.id} checked={style === s.id} onChange={() => setStyle(s.id)} className="peer sr-only" />
              <span className="rounded-xl border-2 border-transparent p-1 transition-colors peer-checked:border-ink peer-focus-visible:outline peer-focus-visible:outline-[3px] peer-focus-visible:outline-offset-2 peer-focus-visible:outline-steel">
                <Preview s={s} />
              </span>
              <span className={`text-center text-[14px] ${style === s.id ? "font-semibold" : "text-ink-2"}`}>{s.name}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-3">
        <button disabled={!ready || busy} className="btn btn-primary w-full">{busy ? "Starting..." : "Make my clips"}</button>
        {error && <p role="alert" className="text-[15px] font-medium text-danger">{error}</p>}
      </div>
    </form>
  );
}
