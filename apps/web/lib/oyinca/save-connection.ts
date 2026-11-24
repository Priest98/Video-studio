import { currentWorkspace } from "@/lib/workspace";
import { adminClient } from "@/lib/supabase/admin";
import { encrypt } from "@/lib/crypto";
import { HttpOyincaClient, OyincaAuthError } from "@/lib/oyinca/client";

/** Verifies a partner token against Oyinca, then stores it encrypted with the accounts it can reach. */
export async function saveOyincaConnection(token: string, label: string): Promise<{ error?: string; accounts?: number }> {
  const { supabase, userId, workspaceId, role } = await currentWorkspace();
  if (!["owner", "admin"].includes(role)) return { error: "Only owners and admins can connect Oyinca." };
  const base = process.env.OYINCA_API_URL;
  if (!base) return { error: "Oyinca is not configured (OYINCA_API_URL)." };

  const { data: blocked } = await supabase.rpc("check_quota", { ws: workspaceId, kind: "connection", amount: 1 });
  if (blocked) return { error: `Plan limit: ${blocked}` };

  let accounts;
  try {
    accounts = await new HttpOyincaClient(base, async () => token).listAccounts();
  } catch (e) {
    return { error: e instanceof OyincaAuthError ? "Oyinca rejected the connection." : `Could not reach Oyinca: ${(e as Error).message}` };
  }

  const { data: conn, error } = await supabase.from("oyinca_connections")
    .insert({ workspace_id: workspaceId, created_by: userId, label, permission_level: "submit" }).select("id").single();
  if (error || !conn) return { error: error?.message ?? "Could not save the connection." };

  const db = adminClient();
  const { error: credError } = await db.from("oyinca_credentials").insert({ connection_id: conn.id, access_token_encrypted: encrypt(token) });
  if (credError) { await db.from("oyinca_connections").delete().eq("id", conn.id); return { error: "Could not store credentials securely." }; }

  if (accounts.length) {
    await db.from("oyinca_accounts").insert(accounts.map((a) => ({
      workspace_id: workspaceId, connection_id: conn.id, external_brand_id: a.brandId, external_account_id: a.accountId,
      platform: a.platform, handle: a.handle ?? null, can_submit: a.canSubmit,
    })));
  }
  return { accounts: accounts.length };
}
