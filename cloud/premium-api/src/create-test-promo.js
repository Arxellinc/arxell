import "dotenv/config";
import Stripe from "stripe";

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
if (!stripeSecretKey) {
  throw new Error("Missing STRIPE_SECRET_KEY");
}

const stripe = new Stripe(stripeSecretKey, { apiVersion: "2024-11-20.acacia" });

const priceId = process.argv[2];
const code = process.argv[3] || "ARX1DOLLAR";
const maxRedemptions = Number(process.argv[4] || "10");

if (!priceId) {
  console.error("Usage: node src/create-test-promo.js <price_id> [code] [max_redemptions]");
  process.exit(1);
}

const price = await stripe.prices.retrieve(priceId);
if (price.currency !== "usd" || typeof price.unit_amount !== "number") {
  throw new Error("This helper currently supports USD fixed-amount prices only.");
}

// $29.00 -> $1.00 first month discount
const amountOff = Math.max(0, price.unit_amount - 100);
if (amountOff <= 0) {
  throw new Error("Price is already <= $1; no discount needed.");
}

const coupon = await stripe.coupons.create({
  amount_off: amountOff,
  currency: "usd",
  duration: "once",
  name: "BA $1 first-month test"
});

const promotionCode = await stripe.promotionCodes.create({
  coupon: coupon.id,
  code,
  max_redemptions: maxRedemptions,
  active: true,
  restrictions: { first_time_transaction: false },
  metadata: {
    purpose: "internal_testing",
    tool: "business_analyst"
  }
});

console.log(JSON.stringify({
  coupon_id: coupon.id,
  promotion_code_id: promotionCode.id,
  code: promotionCode.code,
  max_redemptions: promotionCode.max_redemptions,
  amount_off_cents: amountOff,
  duration: coupon.duration
}, null, 2));
