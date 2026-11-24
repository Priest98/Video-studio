"use server";

import { revalidatePath } from "next/cache";
import { currentWorkspace } from "@/lib/workspace";

export async function disconnectOyinca(formData: FormData) {
  const { supabase, role } = await currentWorkspace();
  if (!["owner", "admin"].includes(role)) return;
  await supabase.from("oyinca_connections").delete().eq("id", String(formData.get("id"))); // cascades credentials and accounts
  revalidatePath("/accounts");
}
