"use client";

import { useMemo, useState, useTransition } from "react";
import { scheduleSequences, shuffleAssignments, type Assignments } from "@/lib/distribution/shuffle";
import { savePlan } from "./actions";

interface Clip { id: string; title: string | null; }
interface Account { id: string; platform: string; handle: string | null; }

export default function Studio({ clips, accounts }: { clips: Clip[]; accounts: Account[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sequences, setSequences] = useState<Assignments | null>(null);
  const [history, setHistory] = useState<Assignments[]>([]);
  const [seed, setSeed] = useState(0);
  const [name, setName] = useState("");
  const [interval, setIntervalMin] = useState(60);
  const [gap, setGap] = useState(90);
  const [start, setStart] = useState(() => new Date(Date.now() + 3600_000).toISOString().slice(0, 16));
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  const key = (c: string, a: string) => `${c}:${a}`;
  const toggle = (c: string, a: string) =>
    setSelected((s) => { const n = new Set(s); if (n.has(key(c, a))) n.delete(key(c, a)); else n.add(key(c, a)); return n; });

  // Original order = clip order as listed; the matrix drives who gets what.
  const original = useMemo<Assignments>(() => {
    const out: Assignments = {};
    for (const a of accounts) {
      const mine = clips.filter((c) => selected.has(key(c.id, a.id))).map((c) => c.id);
      if (mine.length) out[a.id] = mine;
    }
    return out;
  }, [clips, accounts, selected]);

  const current = sequences ?? original;
  const label = (id: string) => clips.find((c) => c.id === id)?.title || id.slice(0, 6);
  const accountName = (id: string) => { const a = accounts.find((x) => x.id === id); return a ? `${a.platform} ${a.handle ?? ""}` : id; };

  const apply = (next: Assignments) => { setHistory((h) => [...h, current]); setSequences(next); };
  const shuffle = () => { const s = Math.floor(Math.random() * 2 ** 31); setSeed(s); apply(shuffleAssignments(original, { seed: s })); };
  const undo = () => setHistory((h) => { if (!h.length) return h; setSequences(h[h.length - 1]); return h.slice(0, -1); });
  const reset = () => { setHistory([]); setSequences(null); setSeed(0); };
  const move = (acc: string, i: number, d: -1 | 1) => {
    const seq = current[acc].slice(); const j = i + d;
    if (j < 0 || j >= seq.length) return;
    [seq[i], seq[j]] = [seq[j], seq[i]];
    apply({ ...current, [acc]: seq });
  };

  const preview = useMemo(() => {
    if (!Object.keys(current).length) return [];
    try { return scheduleSequences(current, { start: new Date(start), intervalMinutes: interval, minCrossAccountGapMinutes: gap }); }
    catch { return []; }
  }, [current, start, interval, gap]);

  const save = () => startTransition(async () => {
    const res = await savePlan({ name, seed, intervalMinutes: interval, minGapMinutes: gap, startAt: new Date(start).toISOString(), sequences: current });
    setMessage(res.error ?? "Plan saved.");
  });

  if (!clips.length || !accounts.length)
    return <p className="text-sm text-black/60">You need generated clips and connected accounts before planning distribution.</p>;

  return (
    <div className="flex flex-col gap-6">
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead><tr><th className="p-2 text-left">Clip</th>{accounts.map((a) => <th key={a.id} className="p-2">{accountName(a.id)}</th>)}</tr></thead>
          <tbody>{clips.map((c) => (
            <tr key={c.id} className="border-t">
              <td className="p-2">{c.title || c.id.slice(0, 8)}</td>
              {accounts.map((a) => (
                <td key={a.id} className="p-2 text-center">
                  <input type="checkbox" aria-label={`${label(c.id)} to ${accountName(a.id)}`} checked={selected.has(key(c.id, a.id))} onChange={() => toggle(c.id, a.id)} />
                </td>))}
            </tr>))}</tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-end gap-3 text-sm">
        <button onClick={shuffle} disabled={!Object.keys(original).length} className="rounded bg-black px-3 py-1.5 text-white disabled:opacity-40">{sequences ? "Reshuffle" : "Shuffle"}</button>
        <button onClick={undo} disabled={!history.length} className="rounded border px-3 py-1.5 disabled:opacity-40">Undo</button>
        <button onClick={reset} className="rounded border px-3 py-1.5">Reset to original order</button>
        <label className="flex flex-col">Start<input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} className="rounded border p-1" /></label>
        <label className="flex flex-col">Minutes between posts<input type="number" min={1} value={interval} onChange={(e) => setIntervalMin(+e.target.value)} className="w-24 rounded border p-1" /></label>
        <label className="flex flex-col">Min gap, same clip across accounts<input type="number" min={0} value={gap} onChange={(e) => setGap(+e.target.value)} className="w-24 rounded border p-1" /></label>
      </div>

      {Object.entries(current).map(([acc, seq]) => (
        <section key={acc}>
          <h3 className="mb-2 font-medium">{accountName(acc)}</h3>
          <ol className="divide-y rounded-lg border text-sm">
            {seq.map((id, i) => {
              const at = preview.find((p) => p.accountId === acc && p.clipId === id)?.at;
              return (
                <li key={id} className="flex items-center gap-3 p-2">
                  <span className="w-6 text-black/50">{i + 1}</span>
                  <span className="flex-1">{label(id)}</span>
                  <span className="text-black/60">{at?.toLocaleString()}</span>
                  <button aria-label="Move up" onClick={() => move(acc, i, -1)} className="px-1">↑</button>
                  <button aria-label="Move down" onClick={() => move(acc, i, 1)} className="px-1">↓</button>
                </li>);
            })}
          </ol>
        </section>
      ))}

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Plan name" className="rounded border p-1.5" />
        <button onClick={save} disabled={pending || !Object.keys(current).length} className="rounded bg-black px-3 py-1.5 text-white disabled:opacity-40">Save plan</button>
        <button disabled title="Needs Oyinca's partner API (see docs/oyinca-integration.md)" className="rounded border px-3 py-1.5 opacity-40">Send to Oyinca</button>
        {message && <span>{message}</span>}
      </div>
      <p className="text-xs text-black/50">Shuffling sets each account&apos;s order and spacing. It does not stop platforms recognising reused video. Nothing publishes without approval in Oyinca.</p>
    </div>
  );
}
