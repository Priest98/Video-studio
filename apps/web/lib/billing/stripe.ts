export type Plan = "free" | "pro" | "agency";

/** Price ids come from env so test and live prices differ without code changes. Prices themselves are not set here. */
export function planFromPriceId(priceId: string | undefined, env: Record<string, string | undefined> = process.env): Plan {
  if (priceId && priceId === env.STRIPE_PRICE_PRO) return "pro";
  if (priceId && priceId === env.STRIPE_PRICE_AGENCY) return "agency";
  return "free";
}

interface SubscriptionEvent {
  type: string;
  data: { object: { id: string; customer: string; status: string; items?: { data: { price: { id: string } }[] } } };
}

export interface BillingDb {
  setPlan(customerId: string, plan: Plan, subscriptionId: string | null): Promise<void>;
}

/** Downgrades to free when a subscription ends or stops being active/trialing. */
export async function applySubscriptionEvent(event: SubscriptionEvent, db: BillingDb, env: Record<string, string | undefined> = process.env) {
  if (!event.type.startsWith("customer.subscription.")) return false;
  const sub = event.data.object;
  const live = event.type !== "customer.subscription.deleted" && ["active", "trialing"].includes(sub.status);
  const plan = live ? planFromPriceId(sub.items?.data[0]?.price.id, env) : "free";
  await db.setPlan(sub.customer, plan, live ? sub.id : null);
  return true;
}
