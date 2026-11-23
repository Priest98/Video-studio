import Stripe from "stripe";
import { NextResponse } from "next/server";
import { adminClient } from "@/lib/supabase/admin";
import { applySubscriptionEvent } from "@/lib/billing/stripe";

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET, key = process.env.STRIPE_SECRET_KEY;
  if (!secret || !key) return NextResponse.json({ error: "Billing is not configured" }, { status: 503 });
  const stripe = new Stripe(key);
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(await request.text(), request.headers.get("stripe-signature") ?? "", secret);
  } catch {
    return NextResponse.json({ error: "bad signature" }, { status: 400 });
  }
  const db = adminClient();
  await applySubscriptionEvent(event as never, {
    async setPlan(customerId, plan, subscriptionId) {
      await db.from("workspaces").update({ plan, stripe_subscription_id: subscriptionId }).eq("stripe_customer_id", customerId);
    },
  });
  return NextResponse.json({ received: true });
}
