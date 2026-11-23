"use client";

import { useActionState } from "react";
import { connectOyinca } from "./actions";

export default function ConnectForm() {
  const [state, action, pending] = useActionState(connectOyinca, undefined);
  return (
    <form action={action} className="flex flex-col gap-3">
      <label htmlFor="label" className="font-semibold">Name</label>
      <input id="label" name="label" placeholder="For example, Client A" className="input" />
      <label htmlFor="token" className="font-semibold">Oyinca token</label>
      <input id="token" name="token" type="password" required autoComplete="off" placeholder="Starts with ptk_" className="input" />
      <p className="text-[15px] text-ink-2">Make the token in Oyinca. It can send clips for approval. It cannot post.</p>
      <button disabled={pending} className="btn btn-primary w-fit">{pending ? "Connecting..." : "Connect Oyinca"}</button>
      {state?.error && <p role="alert" className="font-medium text-danger">{state.error}</p>}
      {state?.ok && <p role="status" className="font-medium text-ok">{state.ok}</p>}
    </form>
  );
}
