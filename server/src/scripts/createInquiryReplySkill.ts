// One-off: hand-author the first Gmail-backed skill (CompanyBrain.md Phase 1).
// Creates it as draft; approve with `npm run review -- approve <id>`.
import { loadServerEnv } from "../env.js";
loadServerEnv();

const { createSkill } = await import("../skills/repo.js");
const { pool } = await import("../db/pool.js");

const skill = await createSkill({
  name: "Customer inquiry reply",
  trigger: "A customer emails a question about the product, pricing, or their account and needs a reply.",
  inputs: ["customer_email", "inquiry_summary"],
  procedure:
    "1. Read the inquiry and identify the actual question. " +
    "2. Call find_context for relevant company decisions or preferences before answering. " +
    "3. Write a concise, friendly reply that answers the question directly; if you don't know, say a human will follow up. " +
    "4. Create the reply as a Gmail draft with create_email_draft, addressed to the customer. " +
    "5. Do NOT send email; a human reviews and sends the draft.",
  hard_rules: [
    "Never send email directly; only create drafts.",
    "Never promise refunds, discounts, or legal terms in a reply.",
    "Never include internal information (credentials, internal URLs, other customers' data) in a draft.",
  ],
  tools: ["create_email_draft"],
  guardrails: [
    "If the inquiry threatens legal action or cancellation, STOP and escalate.",
    "If the inquiry involves billing disputes or refunds, STOP and escalate.",
    "If you are not confident the answer is factually correct, STOP and escalate.",
  ],
  escalation_target: "Founder (a7madinquiries@gmail.com)",
  examples: [
    {
      scenario: "Customer asks whether the product supports exporting data to CSV.",
      correct_action:
        "Check context for the real capability, write a short factual reply, create a Gmail draft to the customer. Human sends.",
    },
    {
      scenario: "Customer says they were double-charged and demands a refund.",
      correct_action: "Billing dispute -> do NOT draft a reply with promises; escalate to the founder.",
    },
  ],
  owner: "Founder",
});

console.log(`created "${skill.name}" as ${skill.status}: id=${skill.id}`);
console.log(`approve with: npm run review -- approve ${skill.id}`);
await pool.end();
