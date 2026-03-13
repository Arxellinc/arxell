import "dotenv/config";
import Stripe from "stripe";

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
if (!stripeSecretKey) {
  throw new Error("Missing STRIPE_SECRET_KEY");
}

const stripe = new Stripe(stripeSecretKey, { apiVersion: "2024-11-20.acacia" });

async function listAllProducts() {
  const out = [];
  let startingAfter;
  for (;;) {
    const page = await stripe.products.list({ limit: 100, active: true, starting_after: startingAfter });
    out.push(...page.data);
    if (!page.has_more || page.data.length === 0) break;
    startingAfter = page.data[page.data.length - 1].id;
  }
  return out;
}

async function listAllPrices() {
  const out = [];
  let startingAfter;
  for (;;) {
    const page = await stripe.prices.list({ limit: 100, active: true, starting_after: startingAfter });
    out.push(...page.data);
    if (!page.has_more || page.data.length === 0) break;
    startingAfter = page.data[page.data.length - 1].id;
  }
  return out;
}

function csvEscape(value) {
  const raw = value == null ? "" : String(value);
  if (raw.includes(",") || raw.includes("\n") || raw.includes('"')) {
    return `"${raw.replaceAll('"', '""')}"`;
  }
  return raw;
}

const products = (await listAllProducts())
  .filter((p) => p.name.startsWith("Arxell Premium Tool - "))
  .sort((a, b) => a.name.localeCompare(b.name));
const prices = await listAllPrices();

const rows = [];
for (const product of products) {
  const productPrices = prices
    .filter((price) => price.product === product.id)
    .filter((price) => price.type === "recurring" && price.currency === "usd" && price.recurring?.interval === "month")
    .sort((a, b) => (a.unit_amount ?? 0) - (b.unit_amount ?? 0));

  if (productPrices.length === 0) {
    rows.push({
      tool_name: product.name.replace("Arxell Premium Tool - ", ""),
      product_name: product.name,
      product_id: product.id,
      price_id: "",
      monthly_usd: "",
      active: String(product.active)
    });
    continue;
  }

  for (const price of productPrices) {
    rows.push({
      tool_name: product.name.replace("Arxell Premium Tool - ", ""),
      product_name: product.name,
      product_id: product.id,
      price_id: price.id,
      monthly_usd: typeof price.unit_amount === "number" ? (price.unit_amount / 100).toFixed(2) : "",
      active: String(product.active && price.active)
    });
  }
}

const headers = ["tool_name", "product_name", "product_id", "price_id", "monthly_usd", "active"];
const lines = [headers.join(",")];
for (const row of rows) {
  lines.push(headers.map((h) => csvEscape(row[h])).join(","));
}

process.stdout.write(`${lines.join("\n")}\n`);
