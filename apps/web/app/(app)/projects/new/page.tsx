"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CAPTION_STYLES, DURATIONS, QUALITIES } from "@/lib/worker/job";

export default function NewProject() {
  const router = useRouter();
  const [mode, setMode] = useState<"upload" | "link">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [link, setLink] = useState("");
  const [rights, setRights] = useState(false);
  const [title, setTitle] = useState("");
  const [style, setStyle] = useState("bold_animated");
  const [capMode, setCapMode] = useState("word");
  const [quality, setQuality] = useState("standard");
  const [count, setCount] = useState(5);
  const [min, setMin] = useState(30);
  const [max, setMax] = useState(60);
  const [categories, setCategories] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const settings = () => ({
    caption_style: style, caption_mode: capMode, quality,
    selection: { clip_count: count, min_seconds: min, max_seconds: max, categories: categories.split(",").map((c) => c.trim()).filter(Boolean) },
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      let projectId: string;
      if (mode === "link") {
        setStatus("Creating project...");
        const r = await fetch("/api/projects/import", { method: "POST", body: JSON.stringify({ url: link, title, rightsConfirmed: rights, settings: settings() }) });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error);
        projectId = j.projectId;
      } else {
        if (!file) return;
        setStatus("Preparing upload...");
        const sign = await fetch("/api/uploads/sign", { method: "POST", body: JSON.stringify({ title: title || file.name, contentType: file.type, size: file.size, settings: settings() }) });
        const signed = await sign.json();
        if (!sign.ok) throw new Error(signed.error);
        setStatus("Uploading...");
        const put = await fetch(signed.uploadUrl, { method: "PUT", body: file, headers: { "content-type": file.type } });
        if (!put.ok) throw new Error("Upload failed.");
        projectId = signed.projectId;
      }
      setStatus("Starting processing...");
      const start = await fetch(`/api/projects/${projectId}/start`, { method: "POST", body: JSON.stringify({}) });
      if (!start.ok) throw new Error((await start.json().catch(() => ({}))).error ?? "Could not start processing.");
      router.push("/projects");
    } catch (err) {
      setStatus((err as Error).message);
      setBusy(false);
    }
  }

  const field = "flex flex-col gap-1 text-sm";
  return (
    <form onSubmit={submit} className="flex max-w-xl flex-col gap-4">
      <h1 className="text-2xl font-semibold">New Project</h1>
      <div className="flex gap-2 text-sm">
        {(["upload", "link"] as const).map((m) => (
          <button type="button" key={m} onClick={() => setMode(m)} className={`rounded border px-3 py-1 ${mode === m ? "bg-black text-white" : ""}`}>{m === "upload" ? "Upload a file" : "Paste a link"}</button>
        ))}
      </div>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" className="rounded border p-2" />
      {mode === "upload" ? (
        <input type="file" accept="video/*" required onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      ) : (
        <>
          <input type="url" required value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://www.youtube.com/watch?v=..." className="rounded border p-2" />
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} className="mt-1" />
            I own this video or have permission to use and republish it. A public link is not permission.</label>
        </>
      )}
      <div className="grid grid-cols-2 gap-3">
        <label className={field}>Caption template<select value={style} onChange={(e) => setStyle(e.target.value)} className="rounded border p-1.5">{CAPTION_STYLES.map((s) => <option key={s}>{s}</option>)}</select></label>
        <label className={field}>Captions<select value={capMode} onChange={(e) => setCapMode(e.target.value)} className="rounded border p-1.5"><option value="word">Word by word</option><option value="sentence">Sentence</option></select></label>
        <label className={field}>Export quality<select value={quality} onChange={(e) => setQuality(e.target.value)} className="rounded border p-1.5">{QUALITIES.map((q) => <option key={q}>{q}</option>)}</select></label>
        <label className={field}>Number of clips<input type="number" min={1} max={20} value={count} onChange={(e) => setCount(+e.target.value)} className="rounded border p-1.5" /></label>
        <label className={field}>Min seconds<select value={min} onChange={(e) => setMin(+e.target.value)} className="rounded border p-1.5">{DURATIONS.map((d) => <option key={d}>{d}</option>)}</select></label>
        <label className={field}>Max seconds<select value={max} onChange={(e) => setMax(+e.target.value)} className="rounded border p-1.5">{DURATIONS.map((d) => <option key={d}>{d}</option>)}</select></label>
      </div>
      <label className={field}>Preferred categories (comma separated)<input value={categories} onChange={(e) => setCategories(e.target.value)} className="rounded border p-1.5" /></label>
      <button disabled={busy || (mode === "upload" ? !file : !link || !rights)} className="rounded bg-black p-2 text-white disabled:opacity-40">Generate clips</button>
      {status && <p className="text-sm">{status}</p>}
    </form>
  );
}
