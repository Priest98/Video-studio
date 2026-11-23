import { createClient } from "@supabase/supabase-js";

/** Service-role client. Server-only; bypasses RLS, so callers must verify the tenant themselves. */
export function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service role is not configured");
  return createClient(url, key, { auth: { persistSession: false } });
}
