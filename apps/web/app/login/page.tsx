"use client";

import Link from "next/link";
import { Logo } from "@/components/logo";
import { useActionState } from "react";
import { login } from "./actions";

export default function LoginPage() {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6">
      <Logo />
      <h1 className="text-2xl font-semibold">Log in</h1>
      <form action={action} className="flex flex-col gap-3">
        <input name="email" type="email" required placeholder="Email" className="rounded border p-2" />
        <input name="password" type="password" required placeholder="Password" className="rounded border p-2" />
        {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
        <button disabled={pending} className="rounded bg-black p-2 text-white disabled:opacity-50">
          {pending ? "Logging in..." : "Log in"}
        </button>
      </form>
      <p className="text-sm">
        No account? <Link href="/signup" className="underline">Sign up</Link>
      </p>
    </main>
  );
}
