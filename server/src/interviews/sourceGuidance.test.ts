import { describe, expect, it } from "vitest";
import type { InterviewSource } from "./types.js";
import {
  DASHBOARD_SOURCE_GUIDANCE,
  sourceDisplayName,
  sourceGuidance,
  sourceMaterialPrompt,
} from "./sourceGuidance.js";

const DASHBOARD_SOURCES = {
  notion: "Notion",
  confluence: "Confluence",
  sharepoint: "SharePoint",
  onedrive: "OneDrive",
  google_drive: "Google Drive",
  gmail: "Gmail",
  outlook: "Outlook",
  slack: "Slack",
  microsoft_teams: "Microsoft Teams",
  jira: "Jira",
  linear: "Linear",
  github: "GitHub",
  asana: "Asana",
  clickup: "ClickUp",
  zendesk: "Zendesk",
  intercom: "Intercom",
  hubspot: "HubSpot",
  salesforce: "Salesforce",
  gong: "Gong",
  zoom: "Zoom",
} as const;

function source(overrides: Partial<InterviewSource> = {}): InterviewSource {
  return {
    id: "source-1",
    interview_id: "interview-1",
    kind: "connector",
    title: "Source material",
    source_type: "notion",
    url: null,
    status: "ready",
    extracted_text: "Useful company material",
    idempotency_key: "source-key",
    added_at: "2026-07-31T00:00:00.000Z",
    retrieved_at: "2026-07-31T00:00:00.000Z",
    error_code: null,
    ...overrides,
  };
}

describe("interview source guidance", () => {
  it("gives every dashboard source explicit provider guidance", () => {
    expect(Object.keys(DASHBOARD_SOURCE_GUIDANCE).sort())
      .toEqual(Object.keys(DASHBOARD_SOURCES).sort());

    for (const [sourceType, providerName] of Object.entries(DASHBOARD_SOURCES)) {
      const prompt = sourceGuidance([source({
        id: sourceType,
        source_type: sourceType,
        extracted_text: `${providerName} material`,
      })]);
      expect(prompt).toContain(`Provider: ${providerName}`);
      expect(prompt).not.toContain("Unknown or newly added company source");
    }
  });

  it("includes only ready sources with material and deduplicates provider rules", () => {
    const prompt = sourceGuidance([
      source({ id: "slack-1", source_type: "slack", extracted_text: "First thread" }),
      source({ id: "slack-2", source_type: "slack", extracted_text: "Second thread" }),
      source({ id: "jira", source_type: "jira", status: "failed", extracted_text: "Ignored" }),
      source({ id: "linear", source_type: "linear", extracted_text: "   " }),
      source({ id: "gmail", source_type: "gmail", status: "reading" }),
    ]);

    expect(prompt.match(/Provider: Slack/g)).toHaveLength(1);
    expect(prompt).not.toContain("Provider: Jira");
    expect(prompt).not.toContain("Provider: Linear");
    expect(prompt).not.toContain("Provider: Gmail");
  });

  it("uses conservative company-source guidance for an unknown provider", () => {
    const prompt = sourceGuidance([
      source({ source_type: "future_source", extracted_text: "Future material" }),
    ]);

    expect(sourceDisplayName("future_source")).toBe("Future Source");
    expect(prompt).toContain("Provider: Future Source");
    expect(prompt).toContain("Unknown or newly added company source");
    expect(prompt).toContain("Do not treat this material as approved company policy");
  });

  it("uses file-specific guidance for uploaded material", () => {
    const prompt = sourceGuidance([
      source({
        kind: "upload",
        source_type: "pdf",
        title: "Refund policy.pdf",
        extracted_text: "Refund policy",
      }),
    ]);

    expect(prompt).toContain("Provider: Uploaded File");
    expect(prompt).toMatch(/extraction or OCR/i);
    expect(prompt).not.toContain("Unknown or newly added company source");
  });

  it("labels every attached material block with its provider and relevant rules", () => {
    const prompt = sourceMaterialPrompt(null, [
      source({
        id: "slack",
        source_type: "slack",
        title: "Refund decisions",
        url: "https://slack.example/archives/refunds",
        extracted_text: "Maya approved refunds below $200.",
      }),
      source({
        id: "salesforce",
        source_type: "salesforce",
        title: "Escalated cases",
        url: null,
        extracted_text: "Cases above $200 move to manager review.",
      }),
    ]);

    expect(prompt).toContain("### Refund decisions\nProvider: Slack");
    expect(prompt).toContain("Source: https://slack.example/archives/refunds");
    expect(prompt).toContain("### Escalated cases\nProvider: Salesforce");
    expect(prompt).toContain("Source: No source URL");
    expect(prompt).toContain("conversational decisions");
    expect(prompt).toContain("structured records");
  });

  it("applies provider guidance to legacy source snapshots", () => {
    const prompt = sourceMaterialPrompt({
      source_type: "notion",
      fetched_at: "2026-07-20T00:00:00.000Z",
      documents: [{
        title: "Refund Runbook",
        url: "https://notion.so/refunds",
        text: "Refunds below $200 are automatic.",
      }],
    }, []);

    expect(prompt).toContain("connected Notion workspace");
    expect(prompt).toContain("### Refund Runbook\nProvider: Notion");
    expect(prompt).toContain("workspace pages, databases, SOPs");
  });

  it("does not include failed, empty, or web material in company source prompts", () => {
    const prompt = sourceMaterialPrompt(null, [
      source({ id: "failed", source_type: "jira", status: "failed", extracted_text: "Failed read" }),
      source({ id: "empty", source_type: "linear", extracted_text: "" }),
      source({
        id: "web",
        kind: "web",
        source_type: "web_research",
        extracted_text: "External research",
      }),
    ]);

    expect(prompt).toBe("");
  });
});
