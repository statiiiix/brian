export interface Order {
  id: string;
  amount: number;
  placed_at: string; // ISO
  account_email: string;
  plan: "standard" | "enterprise";
}

export const ORDERS: Record<string, Order> = {
  "ORD-1": { id: "ORD-1", amount: 40, placed_at: "2026-06-24T00:00:00Z", account_email: "a@example.com", plan: "standard" },
  "ORD-2": { id: "ORD-2", amount: 350, placed_at: "2026-06-20T00:00:00Z", account_email: "b@example.com", plan: "standard" },
  "ORD-3": { id: "ORD-3", amount: 90, placed_at: "2026-06-10T00:00:00Z", account_email: "c@example.com", plan: "enterprise" },
};

export function getOrder(orderId: string): Order | null {
  return ORDERS[orderId] ?? null;
}

export function issueRefund(orderId: string, amount: number) {
  return { refunded: true, order_id: orderId, amount };
}
