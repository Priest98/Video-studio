import { test } from "node:test";
import assert from "node:assert/strict";
import { applySubscriptionEvent, planFromPriceId, type BillingDb, type Plan } from "./stripe.ts";

const env = { STRIPE_PRICE_PRO: "price_pro", STRIPE_PRICE_AGENCY: "price_ag" };
const ev = (type: string, status: string, price = "price_pro") => ({ type, data: { object: { id: "sub_1", customer: "cus_1", status, items: { data: [{ price: { id: price } }] } } } });
function fakeDb() { const calls: [string, Plan, string | null][] = []; const db: BillingDb = { async setPlan(c, p, s) { calls.push([c, p, s]); } }; return { db, calls }; }

test("maps price ids to plans, unknown to free", () => {
  assert.equal(planFromPriceId("price_pro", env), "pro");
  assert.equal(planFromPriceId("price_ag", env), "agency");
  assert.equal(planFromPriceId("other", env), "free");
  assert.equal(planFromPriceId(undefined, env), "free");
});
test("active subscription upgrades; canceled, deleted and past_due drop to free", async () => {
  for (const [type, status, expected] of [
    ["customer.subscription.updated", "active", "pro"], ["customer.subscription.created", "trialing", "pro"],
    ["customer.subscription.updated", "past_due", "free"], ["customer.subscription.updated", "canceled", "free"],
    ["customer.subscription.deleted", "active", "free"],
  ] as const) {
    const { db, calls } = fakeDb();
    assert.equal(await applySubscriptionEvent(ev(type, status), db, env), true);
    assert.equal(calls[0][1], expected, `${type}/${status}`);
  }
});
test("ignores unrelated events", async () => {
  const { db, calls } = fakeDb();
  assert.equal(await applySubscriptionEvent({ type: "invoice.paid", data: { object: { id: "x", customer: "c", status: "paid" } } }, db, env), false);
  assert.equal(calls.length, 0);
});
