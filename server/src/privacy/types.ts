export const DELETION_SCOPES = ["account", "company"] as const;
export type DataDeletionScope = (typeof DELETION_SCOPES)[number];

export const DELETION_STATUSES = [
  "pending",
  "processing",
  "cancelled",
  "completed",
  "failed",
] as const;
export type DataDeletionStatus = (typeof DELETION_STATUSES)[number];

/** Safe API representation. It deliberately contains no email or tenant data. */
export interface DataDeletionRequest {
  id: string;
  scope: DataDeletionScope;
  status: DataDeletionStatus;
  scheduledFor: string;
  createdAt: string;
  cancelledAt: string | null;
  completedAt: string | null;
}
