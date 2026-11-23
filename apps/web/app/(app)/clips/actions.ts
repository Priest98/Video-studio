"use server";

import { revalidatePath } from "next/cache";
import { currentWorkspace } from "@/lib/workspace";

export async function updateClip(formData: FormData) {
  const { supabase, role } = await currentWorkspace();
  if (!["owner", "admin", "editor"].includes(role)) return;
  await supabase.from("clips").update({
    title: String(formData.get("title") ?? "").slice(0, 120), hook: String(formData.get("hook") ?? "").slice(0, 200),
  }).eq("id", String(formData.get("id")));
  revalidatePath("/clips");
}
