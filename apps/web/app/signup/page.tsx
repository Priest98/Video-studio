"use client";

import Link from "next/link";
import { Logo } from "@/components/logo";
import { useActionState } from "react";
import { signup } from "../login/actions";

export default function SignupPage() {
  const [state, action, pending] = useActionState(signup, undefined);
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6">
      <Logo />
      <h1 className="text-2xl font-semibold">Create your account</h1>
      <form action={action} className="flex flex-col gap-3">
        <input name="name" placeholder="Name" className="rounded border p-2" />
        <input name="email" type="email" required placeholder="Email" className="rounded border p-2" />
        <input name="password" type="password" required minLength={8} placeholder="Password (8+ characters)" className="rounded border p-2" />
        {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
        {state?.notice && <p className="text-sm text-green-700">{state.notice}</p>}
        <button disabled={pending} className="rounded bg-black p-2 text-white disabled:opacity-50">
          {pending ? "Creating..." : "Sign up"}
        </button>
      </form>
      <p className="text-sm">
        Have an account? <Link href="/login" className="underline">Log in</Link>
      </p>
    </main>
  );
}
