"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function NewProject() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setStatus("Preparing upload...");
    const sign = await fetch("/api/uploads/sign", { method: "POST", body: JSON.stringify({ title: title || file.name, contentType: file.type, size: file.size }) });
    const signed = await sign.json();
    if (!sign.ok) { setStatus(signed.error); setBusy(false); return; }
    setStatus("Uploading...");
    const put = await fetch(signed.uploadUrl, { method: "PUT", body: file, headers: { "content-type": file.type } });
    if (!put.ok) { setStatus("Upload failed."); setBusy(false); return; }
    setStatus("Starting processing...");
    const start = await fetch(`/api/projects/${signed.projectId}/start`, { method: "POST", body: JSON.stringify({}) });
    const result = await start.json().catch(() => ({}));
    if (!start.ok) { setStatus(result.error ?? "Could not start processing."); setBusy(false); return; }
    router.push("/projects");
  }

  return (
    <form onSubmit={submit} className="flex max-w-md flex-col gap-3">
      <h1 className="text-2xl font-semibold">New Project</h1>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" className="rounded border p-2" />
      <input type="file" accept="video/*" required onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <button disabled={busy || !file} className="rounded bg-black p-2 text-white disabled:opacity-40">Upload and generate clips</button>
      {status && <p className="text-sm">{status}</p>}
      <p className="text-xs text-black/50">Only upload video you have the rights to use. Link import is not built yet.</p>
    </form>
  );
}
