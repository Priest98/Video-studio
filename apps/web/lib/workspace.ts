import { createClient } from "@/lib/supabase/server";
import { OPEN_MODE } from "@/lib/open-mode";

/** The signed-in user's workspace. RLS decides what they can see; this only picks which one to act on. */
export async function currentWorkspace() {
  const supabase = await createClient();
  if (OPEN_MODE) {
    // Single-tenant: the oldest workspace and its owner.
    const { data: ws } = await supabase.from("workspaces").select("id, owner_id").order("created_at").limit(1).single();
    if (!ws) throw new Error("No workspace yet. Create an account once with AUTH_MODE unset, then enable open mode.");
    return { supabase, userId: ws.owner_id as string, workspaceId: ws.id as string, role: "owner" };
  }
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Not signed in");
  const { data } = await supabase
    .from("workspace_members")
    .select("workspace_id, role, workspaces(name, plan)")
    .eq("user_id", auth.user.id)
    .order("created_at")
    .limit(1)
    .single();
  if (!data) throw new Error("No workspace");
  return { supabase, userId: auth.user.id, workspaceId: data.workspace_id as string, role: data.role as string };
}
