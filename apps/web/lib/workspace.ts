import { createClient } from "@/lib/supabase/server";

/** The signed-in user's workspace. RLS decides what they can see; this only picks which one to act on. */
export async function currentWorkspace() {
  const supabase = await createClient();
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
