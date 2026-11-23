import Stripe from "stripe";
import { NextResponse } from "next/server";
import { currentWorkspace } from "@/lib/workspace";
import { adminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const key = process.env.STRIPE_SECRET_KEY;
  const { plan } = await request.json();
  const price = plan === "pro" ? process.env.STRIPE_PRICE_PRO : plan === "agency" ? process.env.STRIPE_PRICE_AGENCY : undefined;
  if (!key || !price) return NextResponse.json({ error: "Billing is not configured" }, { status: 503 });

  const { workspaceId, role } = await currentWorkspace();
  if (!["owner", "admin"].includes(role)) return NextResponse.json({ error: "Only owners and admins manage billing." }, { status: 403 });

  const stripe = new Stripe(key), db = adminClient();
  const { data: ws } = await db.from("workspaces").select("stripe_customer_id, name").eq("id", workspaceId).single();
  let customer = ws?.stripe_customer_id as string | undefined;
  if (!customer) {
    customer = (await stripe.customers.create({ name: ws?.name, metadata: { workspace_id: workspaceId } })).id;
    await db.from("workspaces").update({ stripe_customer_id: customer }).eq("id", workspaceId);
  }
  const origin = new URL(request.url).origin;
  const session = await stripe.checkout.sessions.create({
    mode: "subscription", customer, line_items: [{ price, quantity: 1 }],
    success_url: `${origin}/billing?status=success`, cancel_url: `${origin}/billing?status=cancelled`,
  });
  return NextResponse.json({ url: session.url });
}
