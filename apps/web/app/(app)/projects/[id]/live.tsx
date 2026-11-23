"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/** Refreshes the page while work is in progress so the result appears on its own. */
export function AutoRefresh() {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(t);
  }, [router]);
  return null;
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
