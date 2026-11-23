"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { shuffleAssignments, type Assignments } from "@/lib/distribution/shuffle";
import { savePlan, sendPlan } from "./actions";

interface Account { id: string; platform: string; handle: string | null; }

/** Pick accounts, optionally mix the order, send. Everything lands in Oyinca's approval queue; nothing is published. */
export default function Send({ projectId, clipIds, accounts }: { projectId?: string; clipIds: string[]; accounts: Account[] }) {
  const [picked, setPicked] = useState<Set<string>>(new Set(accounts.length === 1 ? [accounts[0].id] : []));
  const [mix, setMix] = useState(accounts.length > 1);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [pending, start] = useTransition();

  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  if (!accounts.length) {
    return (
      <div className="flex flex-col items-start gap-4">
        <p className="text-ink-2">Connect your Oyinca account first, then come back here.</p>
        <Link href="/accounts" className="btn btn-primary">Connect Oyinca</Link>
      </div>
    );
  }
  if (!clipIds.length) {
    return (
      <div className="flex flex-col items-start gap-4">
        <p className="text-ink-2">There are no finished clips to send yet.</p>
        <Link href="/projects" className="btn btn-quiet">Go to my clips</Link>
      </div>
    );
  }

  const send = () => start(async () => {
    setFailed(false);
    setMessage("");
    const original: Assignments = {};
    for (const a of accounts) if (picked.has(a.id)) original[a.id] = clipIds.slice();
    const seed = Math.floor(Math.random() * 2 ** 31);
    const sequences = mix && picked.size > 1 ? shuffleAssignments(original, { seed }) : original;
    const saved = await savePlan({
      name: `Send ${new Date().toLocaleDateString()}`, projectId, seed, intervalMinutes: 60, minGapMinutes: 90,
      startAt: new Date(Date.now() + 3600_000).toISOString(), sequences,
    });
    if (saved.error || !saved.id) { setFailed(true); setMessage(saved.error ?? "Could not prepare this. Try again."); return; }
    const res = await sendPlan(saved.id);
    if (res.error || !res.results) { setFailed(true); setMessage(res.error ?? "Could not send. Try again."); return; }
    const r = res.results;
    if (r.failed || r.pending) {
      setFailed(true);
      setMessage(`${r.awaiting_approval} sent. ${r.failed + r.pending} did not go through. Press Send again to retry them.`);
    } else {
      setMessage(`Sent. ${r.awaiting_approval} clip${r.awaiting_approval === 1 ? " is" : "s are"} waiting for your approval in Oyinca.`);
    }
  });

  return (
    <div className="flex flex-col gap-8">
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-2 font-semibold">Send to</legend>
        {accounts.map((a) => (
          <label key={a.id} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl px-1 hover:bg-sunken/60">
            <input type="checkbox" checked={picked.has(a.id)} onChange={() => toggle(a.id)} className="size-5 accent-[#0a1931]" />
            <span className="capitalize">{a.platform.toLowerCase()}</span>
            {a.handle && <span className="text-ink-2">{a.handle}</span>}
          </label>
        ))}
      </fieldset>

      {accounts.length > 1 && (
        <label className="flex items-start gap-3">
          <input type="checkbox" checked={mix} onChange={(e) => setMix(e.target.checked)} className="mt-1 size-5 accent-[#0a1931]" />
          <span>
            Mix the order for each account
            <span className="block text-[15px] text-ink-2">Every account gets the same clips in a different order and at different times.</span>
          </span>
        </label>
      )}

      <div className="flex flex-col gap-3">
        <button onClick={send} disabled={pending || picked.size === 0} className="btn btn-primary w-full">
          {pending ? "Sending..." : `Send ${clipIds.length} clip${clipIds.length === 1 ? "" : "s"} to Oyinca`}
        </button>
        <p className="text-[15px] text-ink-2">Nothing is posted. You approve each clip in Oyinca first.</p>
        {message && <p role={failed ? "alert" : "status"} className={`font-medium ${failed ? "text-danger" : "text-ok"}`}>{message}</p>}
      </div>
    </div>
  );
}
