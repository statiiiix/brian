// Manual smoke test: creates ONE real draft in the configured Gmail account.
import { loadServerEnv } from "../env.js";
loadServerEnv();

const { gmailConfigFromEnv, createDraft } = await import("../gmail/client.js");

const cfg = gmailConfigFromEnv();
if (!cfg) {
  console.error("Gmail not configured. Follow docs/gmail-setup.md first.");
  process.exit(1);
}
const res = await createDraft(cfg, {
  to: "a7madinquiries@gmail.com",
  subject: "Brian smoke test",
  body: "If you can read this in your Drafts folder, the Gmail adapter works. You can delete it.",
});
console.log(`Draft created: ${res.draft_id}. Check the Drafts folder, then delete it.`);
