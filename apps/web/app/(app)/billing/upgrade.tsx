"use client";

import { useState } from "react";

export default function Upgrade() {
  const [msg, setMsg] = useState("");
  async function go(plan: string) {
    const r = await fetch("/api/billing/checkout", { method: "POST", body: JSON.stringify({ plan }) });
    const j = await r.json();
    if (j.url) window.location.href = j.url; else setMsg(j.error ?? "Could not start checkout.");
  }
  return (
    <div className="flex items-center gap-3 text-sm">
      <button onClick={() => go("pro")} className="rounded border px-3 py-1.5">Upgrade to Pro</button>
      <button onClick={() => go("agency")} className="rounded border px-3 py-1.5">Upgrade to Agency</button>
      {msg && <span className="text-black/60">{msg}</span>}
    </div>
  );
}
