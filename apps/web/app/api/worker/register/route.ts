import { NextResponse } from "next/server";
import { adminClient } from "@/lib/supabase/admin";
import { bearerMatches, parseWorkerUrl } from "@/lib/worker/endpoint";

/** The media worker calls this on start-up and every few minutes with its current public address. */
export async function POST(request: Request) {
  if (!bearerMatches(request.headers.get("authorization"), process.env.WORKER_TOKEN)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { url } = await request.json().catch(() => ({}));
  const clean = parseWorkerUrl(url, process.env.WORKER_ALLOWED_HOSTS);
  if (!clean) return NextResponse.json({ error: "Address not allowed" }, { status: 400 });
  const { error } = await adminClient().from("worker_endpoint").upsert({ id: 1, url: clean, updated_at: new Date().toISOString() });
  if (error) return NextResponse.json({ error: "Could not save" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
