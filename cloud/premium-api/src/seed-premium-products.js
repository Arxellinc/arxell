import "dotenv/config";
import Stripe from "stripe";

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
if (!stripeSecretKey) {
  throw new Error("Missing STRIPE_SECRET_KEY");
}

const stripe = new Stripe(stripeSecretKey, { apiVersion: "2024-11-20.acacia" });

const premiumTools = [
  { id: "premium-google-drive", title: "Google Drive Integration", monthlyUsd: 9 },
  { id: "premium-cloud-sync", title: "Cloud Account Sync", monthlyUsd: 12 },
  { id: "premium-specialist-agents", title: "Specialist Agents", monthlyUsd: 29 },
  { id: "premium-vector-rag", title: "Managed Vector DB + RAG Indexing", monthlyUsd: 19 },
  { id: "premium-team-memory", title: "Team Memory Cloud", monthlyUsd: 15 },
  { id: "premium-browser-cloud", title: "Browser Automation Cloud", monthlyUsd: 25 },
  { id: "premium-secrets-vault", title: "Secure Vault + Secrets Manager", monthlyUsd: 18 },
  { id: "premium-exec-sandbox", title: "Code Execution Sandbox Cloud", monthlyUsd: 22 },
  { id: "premium-connectors-pack", title: "Enterprise Connectors Pack", monthlyUsd: 30 },
  { id: "premium-meeting-intel", title: "Meeting Intelligence", monthlyUsd: 16 },
  { id: "premium-voice-agent", title: "Voice/Phone Agent", monthlyUsd: 35 },
  { id: "premium-alert-ops", title: "Monitoring + Alert Ops", monthlyUsd: 24 },
  { id: "premium-compliance", title: "Specialist Compliance Agents", monthlyUsd: 39 },
  { id: "premium-finops", title: "FinOps/Cost Optimizer", monthlyUsd: 21 },
  { id: "premium-hitl", title: "Human-in-the-loop Workflow", monthlyUsd: 20 },
  { id: "premium-routing", title: "Model Routing Premium", monthlyUsd: 17 },
  { id: "premium-org-analytics", title: "Org Analytics", monthlyUsd: 14 },
  { id: "premium-backup", title: "Backup/Restore + Versioned State", monthlyUsd: 12 }
];

async function findProduct(tool) {
  let startingAfter;
  for (;;) {
    const page = await stripe.products.list({ limit: 100, starting_after: startingAfter, active: true });
    const found = page.data.find((product) => {
      const byMetadata = (product.metadata?.tool_id || "") === tool.id;
      const byName = product.name === `Arxell Premium Tool - ${tool.title}`;
      return byMetadata || byName;
    });
    if (found) return found;
    if (!page.has_more || page.data.length === 0) return null;
    startingAfter = page.data[page.data.length - 1].id;
  }
}

async function ensureProduct(tool) {
  const name = `Arxell Premium Tool - ${tool.title}`;
  const existing = await findProduct(tool);
  if (existing) return existing;
  return stripe.products.create({
    name,
    description: "Premium tool subscription (coming soon)",
    metadata: {
      tool_id: tool.id,
      lifecycle: "coming_soon"
    }
  });
}

async function ensureMonthlyPrice(product, tool) {
  let startingAfter;
  for (;;) {
    const page = await stripe.prices.list({ product: product.id, limit: 100, active: true, starting_after: startingAfter });
    const existing = page.data.find(
      (price) =>
        price.type === "recurring" &&
        price.currency === "usd" &&
        price.recurring?.interval === "month" &&
        price.unit_amount === tool.monthlyUsd * 100
    );
    if (existing) return existing;
    if (!page.has_more || page.data.length === 0) break;
    startingAfter = page.data[page.data.length - 1].id;
  }

  return stripe.prices.create({
    product: product.id,
    unit_amount: tool.monthlyUsd * 100,
    currency: "usd",
    recurring: { interval: "month" },
    metadata: {
      tool_id: tool.id,
      lifecycle: "coming_soon"
    }
  });
}

const results = [];
for (const tool of premiumTools) {
  const product = await ensureProduct(tool);
  const price = await ensureMonthlyPrice(product, tool);
  results.push({
    tool_id: tool.id,
    product_id: product.id,
    product_name: product.name,
    price_id: price.id,
    monthly_usd: tool.monthlyUsd
  });
}

console.log(JSON.stringify({ seeded: results.length, tools: results }, null, 2));
