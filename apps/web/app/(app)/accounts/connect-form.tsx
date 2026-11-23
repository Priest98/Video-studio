"use client";

import { useActionState } from "react";
import { connectOyinca } from "./actions";

export default function ConnectForm() {
  const [state, action, pending] = useActionState(connectOyinca, undefined);
  return (
    <form action={action} className="flex max-w-md flex-col gap-2 text-sm">
      <input name="label" placeholder="Label (e.g. Client A)" className="rounded border p-2" />
      <input name="token" type="password" required placeholder="Oyinca integration token (ptk_...)" className="rounded border p-2" autoComplete="off" />
      <button disabled={pending} className="w-fit rounded bg-black px-3 py-1.5 text-white disabled:opacity-40">{pending ? "Connecting..." : "Connect Oyinca"}</button>
      {state?.error && <p className="text-red-600">{state.error}</p>}
      {state?.ok && <p className="text-green-700">{state.ok}</p>}
      <p className="text-xs text-black/50">Create the token in Oyinca. It can only submit clips for approval; it cannot publish.</p>
    </form>
  );
}
