import { runMigrations } from "./db/migrate.js";
import { pool } from "./db/pool.js";
import { createSkill, setStatus } from "./skills/repo.js";
import type { NewSkill } from "./skills/types.js";

const refund: NewSkill = {
  name: "Refund Handling",
  trigger: "A customer requests a refund on a past order.",
  inputs: ["order_id", "customer_email", "reason"],
  procedure:
    "1. Look up the order. 2. Check the order date. 3. If within the refund window and the reason is valid, issue the refund for the order amount. 4. Confirm to the customer. 5. If outside the window or the amount is large, follow the guardrails.",
  hard_rules: [
    "Never refund an order older than 90 days.",
    "Never refund more than $200 without manager approval.",
    "Never issue a refund to an account other than the one that placed the order.",
  ],
  tools: ["get_order", "issue_refund"],
  guardrails: [
    "If refund amount > $200, STOP and escalate.",
    "If the customer is on an enterprise plan, STOP and escalate.",
    "If the order cannot be found, STOP and escalate.",
  ],
  escalation_target: "Support team lead",
  examples: [
    { scenario: "Customer requests refund on a $40 order placed 5 days ago, item defective.", correct_action: "Within window, under threshold, valid reason -> issue $40 refund and confirm." },
    { scenario: "Customer requests refund on a $350 order.", correct_action: "Over $200 threshold -> do NOT refund; escalate to support team lead." },
  ],
  owner: "Support team lead",
};

const triage: NewSkill = {
  name: "Support Ticket Triage",
  trigger: "A new inbound support ticket arrives and must be categorized and routed.",
  inputs: ["ticket_id", "customer_email", "message"],
  procedure:
    "1. Read the ticket. 2. Categorize: billing, bug, how-to, or security. 3. If how-to, answer from docs. 4. If billing or bug, route to the owning team. 5. If security or threat to churn, follow the guardrails.",
  hard_rules: [
    "Never promise a refund or credit in a support reply.",
    "Never share data from another customer's account.",
  ],
  tools: ["get_ticket", "lookup_customer", "post_reply"],
  guardrails: [
    "If the ticket reports a security/data issue, STOP and escalate.",
    "If the customer threatens to cancel, STOP and escalate.",
  ],
  escalation_target: "Support team lead",
  examples: [
    { scenario: "User asks how to export their data.", correct_action: "How-to -> answer from docs and resolve." },
    { scenario: "User reports they can see another account's invoice.", correct_action: "Security issue -> do NOT reply with data; escalate immediately." },
  ],
  owner: "Support team lead",
};

async function main() {
  await runMigrations(pool);
  for (const s of [refund, triage]) {
    const created = await createSkill(s);
    await setStatus(created.id, "active");
    console.log(`seeded + activated: ${created.name} (${created.id})`);
  }
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
