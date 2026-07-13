import { describe, expect, it } from "vitest";
import {
  DEFAULT_DELETION_GRACE_DAYS,
  deletionGracePeriodDays,
  deletionRequestFromRow,
} from "./repo.js";

describe("privacy deletion repository helpers", () => {
  it("uses a documented 30-day default and accepts a bounded override", () => {
    expect(deletionGracePeriodDays(undefined)).toBe(DEFAULT_DELETION_GRACE_DAYS);
    expect(DEFAULT_DELETION_GRACE_DAYS).toBe(30);
    expect(deletionGracePeriodDays("45")).toBe(45);
    expect(() => deletionGracePeriodDays("0")).toThrow(/between 1 and 365/);
    expect(() => deletionGracePeriodDays("1.5")).toThrow(/between 1 and 365/);
    expect(() => deletionGracePeriodDays("not-a-number")).toThrow(/between 1 and 365/);
  });

  it("maps only the safe camelCase request contract", () => {
    expect(deletionRequestFromRow({
      request_id: "10000000-0000-4000-8000-000000000014",
      request_scope: "company",
      request_status: "pending",
      request_scheduled_for: "2026-08-12T00:00:00.000Z",
      request_created_at: "2026-07-13T00:00:00.000Z",
      request_cancelled_at: null,
      request_completed_at: null,
      email: "must-not-leak@example.test",
      tenant_id: "10000000-0000-4000-8000-000000000015",
    })).toEqual({
      id: "10000000-0000-4000-8000-000000000014",
      scope: "company",
      status: "pending",
      scheduledFor: "2026-08-12T00:00:00.000Z",
      createdAt: "2026-07-13T00:00:00.000Z",
      cancelledAt: null,
      completedAt: null,
    });
  });
});
