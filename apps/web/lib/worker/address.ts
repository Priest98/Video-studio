import { adminClient } from "@/lib/supabase/admin";

/** WORKER_URL wins when set; otherwise the address the worker last reported. */
export async function workerAddress(): Promise<string | undefined> {
  // Ignore placeholder text left in the setting; only a real web address counts.
  if (process.env.WORKER_URL && /^https?:\/\//.test(process.env.WORKER_URL)) return process.env.WORKER_URL;
  const { data } = await adminClient().from("worker_endpoint").select("url").eq("id", 1).maybeSingle();
  return data?.url ?? undefined;
}
