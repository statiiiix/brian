export type ToolRisk = "safe" | "destructive";

const REGISTRY: Record<string, ToolRisk> = {
  get_order: "safe",
  lookup_customer: "safe",
  get_ticket: "safe",
  find_skill: "safe",
  get_skill: "safe",
  find_context: "safe",
  create_email_draft: "safe", // reversible: a human reviews/sends/deletes the draft
  issue_refund: "destructive",
  send_email: "destructive", // irreversible once sent
  post_reply: "destructive",
  page_oncall: "destructive",
};

export function toolRisk(name: string): ToolRisk {
  return REGISTRY[name] ?? "destructive"; // unknown tools fail safe
}

export function skillIsAutoSafe(tools: string[]): boolean {
  return tools.every((t) => toolRisk(t) === "safe");
}
