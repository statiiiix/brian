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

// What a safe lookup establishes, so a compiled rule can reference
// facts.order.placed_at after the agent has actually looked the order up.
// Only safe (read-only) tools contribute facts.
const FACT_SUBJECTS: Record<string, string> = {
  get_order: "order",
  lookup_customer: "customer",
  get_ticket: "ticket",
};

export function factSubject(name: string): string | null {
  return toolRisk(name) === "safe" ? FACT_SUBJECTS[name] ?? null : null;
}

export function skillIsAutoSafe(tools: string[]): boolean {
  return tools.every((t) => toolRisk(t) === "safe");
}
