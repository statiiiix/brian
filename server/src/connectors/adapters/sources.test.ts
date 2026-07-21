import { describe, it, expect, vi } from "vitest";
import { adfToText, apiJson, sinceIso, stripHtml, vttToText } from "./sources/common.js";
import { notionBlocksToText, notionConnector, notionPageToRaw } from "./sources/notion.js";
import { confluencePageToRaw, jiraIssueToRaw } from "./sources/atlassian.js";
import {
  driveItemToRaw, microsoftTeamsConnector, onedriveConnector, outlookConnector,
  outlookConversationToRaw, sharepointConnector, teamsMessagesToRaw,
} from "./sources/microsoft.js";
import {
  asanaConnector, asanaTaskToRaw, clickupConnector, clickupTaskToRaw,
  githubConnector, githubIssueToRaw, linearConnector, linearIssueToRaw,
} from "./sources/workSystems.js";
import { gongCallToRaw, hubspotDealToRaw, intercomConversationToRaw, salesforceOpportunityToRaw, zendeskTicketToRaw } from "./sources/customerSystems.js";
import { zoomConnector, zoomMeetingToRaw } from "./sources/zoom.js";
import { buildConnector, SYNCABLE_TYPES } from "./index.js";
import { AUTHORIZED_SOURCE_TYPES } from "../types.js";

describe("source text helpers", () => {
  it("redacts provider response bodies from request errors", async () => {
    const fetchFn = vi.fn(async () => new Response("private source diagnostic", { status: 502 })) as unknown as typeof fetch;
    const error = await apiJson(fetchFn, "https://provider.test/items").catch((caught) => caught as Error);
    expect(error.message).toBe("provider.test request failed (502)");
    expect(error.message).not.toContain("private source diagnostic");
  });

  it("stripHtml flattens markup and entities", () => {
    expect(stripHtml("<p>Refunds &amp; credits</p><ul><li>escalate</li></ul>"))
      .toBe("Refunds & credits\n escalate");
  });

  it("adfToText walks Jira rich documents", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Only the CEO" }, { type: "text", text: "approves >20%" }] },
        { type: "paragraph", content: [{ type: "text", text: "Second line" }] },
      ],
    };
    expect(adfToText(doc)).toBe("Only the CEO approves >20%\nSecond line");
  });

  it("vttToText keeps only cue payload lines", () => {
    const vtt = "WEBVTT\n\n1\n00:00:01.000 --> 00:00:03.000\nMaya: never refund above $500\n\n2\n00:00:04.000 --> 00:00:06.000\nSam: escalate to finance";
    expect(vttToText(vtt)).toBe("Maya: never refund above $500\nSam: escalate to finance");
  });

  it("sinceIso prefers the stored watermark and falls back to a window", () => {
    expect(sinceIso({ updated_since: "2026-07-01T00:00:00.000Z" })).toBe("2026-07-01T00:00:00.000Z");
    const fallback = Date.parse(sinceIso(null, 10));
    expect(Math.abs(Date.now() - 10 * 86_400_000 - fallback)).toBeLessThan(5_000);
  });
});

describe("document sources map to RawThread documents", () => {
  it("notion pages carry title, editor, and block text", () => {
    const page = {
      id: "p1",
      url: "https://notion.so/p1",
      last_edited_time: "2026-07-10T00:00:00.000Z",
      last_edited_by: { id: "u1" },
      properties: { Name: { type: "title", title: [{ plain_text: "Refund policy" }] } },
    };
    const raw = notionPageToRaw(page, notionBlocksToText([
      { type: "paragraph", paragraph: { rich_text: [{ plain_text: "Max refund is $500." }] } },
      { type: "heading_1", heading_1: { rich_text: [{ plain_text: "Escalation" }] } },
    ]));
    expect(raw.source_kind).toBe("document");
    expect(raw.title).toBe("Refund policy");
    expect(raw.messages[0].text).toBe("Max refund is $500.\nEscalation");
    expect(raw.participants[0].is_company_member).toBe(true);
  });

  it("confluence pages strip storage HTML", () => {
    const raw = confluencePageToRaw({
      id: "42",
      title: "Runbook",
      body: { storage: { value: "<h1>Rollback</h1><p>Page the on-call first.</p>" } },
      history: { lastUpdated: { by: { accountId: "acc1" }, when: "2026-07-01T00:00:00Z" } },
      _links: { webui: "/spaces/OPS/runbook" },
    }, "https://api.atlassian.com/ex/confluence/cloud/wiki");
    expect(raw.thread_id).toBe("confluence:42");
    expect(raw.messages[0].text).toContain("Page the on-call first.");
    expect(raw.permalink).toContain("/spaces/OPS/runbook");
  });

  it("drive items and CRM records become owner documents", () => {
    const drive = driveItemToRaw({ id: "f1", name: "policy.md", webUrl: "https://x", lastModifiedBy: { user: { email: "maya@acme.com" } } }, "text", "sharepoint");
    expect(drive.thread_id).toBe("sharepoint:f1");
    expect(drive.participants[0].id).toBe("maya@acme.com");

    const deal = hubspotDealToRaw({ id: "d1", properties: { dealname: "Acme", dealstage: "closedwon", amount: "1200" }, updatedAt: "2026-07-01" }, "999");
    expect(deal.messages[0].text).toContain("Stage: closedwon");
    expect(deal.permalink).toBe("https://app.hubspot.com/contacts/999/deal/d1");

    const opp = salesforceOpportunityToRaw({ Id: "006", Name: "Big deal", StageName: "Negotiation", Owner: { Name: "Rae" } }, "https://acme.my.salesforce.com/");
    expect(opp.permalink).toBe("https://acme.my.salesforce.com/lightning/r/Opportunity/006/view");
    expect(opp.participants[0].id).toBe("Rae");
  });

  it("gong calls prefer transcripts and fall back to titles", () => {
    const call = { id: "c1", title: "Renewal call", started: "2026-07-01", url: "https://gong/c1" };
    const withTranscript = gongCallToRaw(call, [{ speakerId: "s1", sentences: [{ text: "We cap discounts at 15%." }] }]);
    expect(withTranscript.messages[0].text).toBe("We cap discounts at 15%.");
    const bare = gongCallToRaw(call, []);
    expect(bare.messages[0].text).toBe("Renewal call");
  });

  it("zoom recordings carry the parsed transcript", () => {
    const raw = zoomMeetingToRaw({ uuid: "z1", topic: "Ops sync", host_email: "ops@acme.com" }, "Maya: rollback rules");
    expect(raw.thread_id).toBe("zoom:z1");
    expect(raw.messages[0].text).toBe("Maya: rollback rules");
  });
});

describe("thread sources keep participants and comments", () => {
  it("jira issues merge description and comments", () => {
    const raw = jiraIssueToRaw({
      key: "OPS-1",
      fields: {
        summary: "Access approval",
        description: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Needs security sign-off" }] }] },
        creator: { displayName: "Maya" },
        comment: { comments: [{ author: { displayName: "Sam" }, created: "2026-07-01", body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Escalate if prod" }] }] } }] },
      },
    }, "https://api.atlassian.com/ex/jira/cloud");
    expect(raw.thread_id).toBe("jira:OPS-1");
    expect(raw.participants.map((p) => p.id)).toEqual(["Maya", "Sam"]);
    expect(raw.messages[1].text).toBe("Escalate if prod");
  });

  it("teams threads flag application senders as bots", () => {
    const raw = teamsMessagesToRaw("t1", "c1",
      { id: "m1", from: { user: { displayName: "Maya" } }, body: { content: "<p>Who approves?</p>" } },
      [{ id: "m2", from: { application: { displayName: "Workflow bot" } }, body: { content: "auto-reply" } }],
      "https://teams/thread");
    expect(raw.participants.find((p) => p.id === "Workflow bot")?.is_bot).toBe(true);
    expect(raw.messages[0].text).toBe("Who approves?");
  });

  it("outlook conversations group and flag no-reply senders", () => {
    const raw = outlookConversationToRaw([
      { id: "m1", conversationId: "conv1", subject: "Discount request", from: { emailAddress: { address: "rep@acme.com" } }, body: { content: "<p>Can we do 25%?</p>" } },
      { id: "m2", conversationId: "conv1", from: { emailAddress: { address: "noreply@crm.com" } }, body: { content: "auto" } },
    ]);
    expect(raw.thread_id).toBe("outlook:conv1");
    expect(raw.participants.find((p) => p.id === "noreply@crm.com")?.is_bot).toBe(true);
  });

  it("linear, github, asana, and clickup map issues with comments", () => {
    const linear = linearIssueToRaw({ identifier: "ENG-9", title: "Rotate keys", url: "https://linear/e9", creator: { name: "Maya" }, comments: { nodes: [{ body: "quarterly", user: { name: "Sam" } }] } });
    expect(linear.messages).toHaveLength(2);

    const github = githubIssueToRaw("acme/api", { number: 7, title: "Incident runbook", user: { login: "maya" }, html_url: "https://gh/7" }, [{ body: "LGTM", user: { login: "bot[bot]", type: "Bot" } }]);
    expect(github.thread_id).toBe("github:acme/api#7");
    expect(github.participants.find((p) => p.id === "bot[bot]")?.is_bot).toBe(true);

    const asana = asanaTaskToRaw({ gid: "1", name: "Onboard hire", notes: "checklist", assignee: { name: "Rae" } }, [{ type: "comment", text: "add laptop step", created_by: { name: "Sam" } }, { type: "system", text: "moved" }]);
    expect(asana.messages).toHaveLength(2); // system story dropped

    const clickup = clickupTaskToRaw({ id: "9", name: "Vendor review", date_updated: "1751328000000", creator: { username: "maya" } }, [{ comment_text: "legal must approve", user: { username: "sam" }, date: "1751328000000" }]);
    expect(clickup.messages[1].text).toBe("legal must approve");
    expect(clickup.messages[0].ts).toBe(new Date(1751328000000).toISOString());
  });

  it("zendesk marks agents as company members; intercom marks admins", () => {
    const zendesk = zendeskTicketToRaw("acme", { id: 5, subject: "Refund" }, [
      { author_id: 1, plain_body: "I want a refund" },
      { author_id: 2, plain_body: "Approved once, per policy" },
    ], new Set([2]));
    expect(zendesk.permalink).toBe("https://acme.zendesk.com/agent/tickets/5");
    expect(zendesk.participants.find((p) => p.id === "2")?.is_company_member).toBe(true);
    expect(zendesk.participants.find((p) => p.id === "1")?.is_company_member).toBe(false);

    const intercom = intercomConversationToRaw({
      id: "c1",
      source: { author: { type: "user", name: "Customer" }, body: "<p>Charge is wrong</p>" },
      conversation_parts: { conversation_parts: [{ part_type: "comment", body: "<p>Refunding now</p>", author: { type: "admin", name: "Sam" } }] },
    });
    expect(intercom.participants.find((p) => p.id === "Sam")?.is_company_member).toBe(true);
    expect(intercom.messages[1].text).toBe("Refunding now");
  });
});

describe("registry", () => {
  it("builds a connector for every authorized source type", () => {
    for (const type of AUTHORIZED_SOURCE_TYPES) {
      const connector = buildConnector(type, { access_token: "tok" });
      expect(connector.type).toBe(type);
      expect(typeof connector.fetch).toBe("function");
    }
  });

  it("declares every source syncable", () => {
    for (const type of AUTHORIZED_SOURCE_TYPES) expect(SYNCABLE_TYPES).toContain(type);
    expect(SYNCABLE_TYPES).toContain("gmail");
  });
});

describe("saved resource selection", () => {
  it.each([
    ["GitHub", githubConnector],
    ["Asana", asanaConnector],
    ["ClickUp", clickupConnector],
    ["SharePoint", sharepointConnector],
    ["Microsoft Teams", microsoftTeamsConnector],
    ["OneDrive", onedriveConnector],
    ["Outlook", outlookConnector],
  ])("refuses %s access before any provider request when selection is absent", async (_label, build) => {
    const fetchFn = vi.fn(async () => { throw new Error("provider request should not run"); }) as unknown as typeof fetch;
    await expect(build({ access_token: "placeholder" }, fetchFn).fetch({}, null))
      .rejects.toThrow("explicit saved resource selection is required");
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("safe incremental cursors", () => {
  const previous = { updated_since: "2026-07-01T00:00:00.000Z" };

  it("retains the previous Linear cursor when the first page is capped", async () => {
    const nodes = Array.from({ length: 25 }, (_, index) => ({
      identifier: `ENG-${index}`, updatedAt: "2026-07-10T00:00:00.000Z",
    }));
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ data: { issues: { nodes } } }), {
      status: 200, headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
    const out = await linearConnector({ access_token: "placeholder" }, fetchFn).fetch({}, previous);
    expect(out.nextCursor).toEqual(previous);
  });

  it("retains the previous GitHub cursor when an issue page is capped", async () => {
    const issues = Array.from({ length: 10 }, (_, index) => ({ number: index + 1, title: `Issue ${index + 1}` }));
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(issues), {
      status: 200, headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
    const out = await githubConnector({
      access_token: "placeholder", selected_repositories: ["acme/api"],
    }, fetchFn).fetch({}, previous);
    expect(out.nextCursor).toEqual(previous);
  });

  it("rejects a failed SharePoint nested request instead of returning a new cursor", async () => {
    const fetchFn = vi.fn(async () => new Response("provider diagnostic", { status: 503 })) as unknown as typeof fetch;
    await expect(sharepointConnector({
      access_token: "placeholder", selected_site_ids: ["site-1"],
    }, fetchFn).fetch({}, previous)).rejects.toThrow("request failed (503)");
  });

  it("rejects a failed Teams reply request instead of returning a new cursor", async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => String(url).includes("/replies")
      ? new Response("provider diagnostic", { status: 503 })
      : new Response(JSON.stringify({ value: [{ id: "message-1", body: { content: "Decision" } }] }), {
          status: 200, headers: { "content-type": "application/json" },
        })) as unknown as typeof fetch;
    await expect(microsoftTeamsConnector({
      access_token: "placeholder",
      selected_channels: [{ team_id: "team-1", channel_id: "channel-1" }],
    }, fetchFn).fetch({}, previous)).rejects.toThrow("request failed (503)");
  });

  it("rejects a failed Zoom transcript download instead of returning a new cursor", async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => String(url).includes("recordings?")
      ? new Response(JSON.stringify({ meetings: [{
          uuid: "meeting-1", recording_files: [{ file_type: "TRANSCRIPT", download_url: "https://zoom.test/transcript" }],
        }] }), { status: 200, headers: { "content-type": "application/json" } })
      : new Response("provider diagnostic", { status: 503 })) as unknown as typeof fetch;
    await expect(zoomConnector({ access_token: "placeholder" }, fetchFn).fetch({}, previous))
      .rejects.toThrow("download failed (503)");
  });

  it("retains the previous Asana cursor when a task page is capped", async () => {
    const tasks = Array.from({ length: 10 }, (_, index) => ({ gid: `task-${index}`, name: `Task ${index}` }));
    const fetchFn = vi.fn(async (url: string | URL | Request) => new Response(JSON.stringify(
      String(url).includes("/stories") ? { data: [] } : { data: tasks },
    ), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
    const out = await asanaConnector({
      access_token: "placeholder", selected_project_ids: ["project-1"],
    }, fetchFn).fetch({}, previous);
    expect(out.nextCursor).toEqual(previous);
  });

  it("retains the previous ClickUp cursor when a task page is capped", async () => {
    const tasks = Array.from({ length: 100 }, (_, index) => ({ id: `task-${index}`, name: `Task ${index}` }));
    const fetchFn = vi.fn(async (url: string | URL | Request) => new Response(JSON.stringify(
      String(url).includes("/comment") ? { comments: [] } : { tasks },
    ), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
    const out = await clickupConnector({
      access_token: "placeholder", selected_team_id: "team-1",
    }, fetchFn).fetch({}, previous);
    expect(out.nextCursor).toEqual(previous);
  });

  it("retains the previous OneDrive cursor when a recent-items page is capped", async () => {
    const files = Array.from({ length: 50 }, (_, index) => ({
      id: `file-${index}`, name: `file-${index}.txt`, file: { mimeType: "text/plain" },
      lastModifiedDateTime: "2026-07-10T00:00:00.000Z",
    }));
    const fetchFn = vi.fn(async (url: string | URL | Request) => String(url).endsWith("/content")
      ? new Response("content", { status: 200 })
      : new Response(JSON.stringify({ value: files }), {
          status: 200, headers: { "content-type": "application/json" },
        })) as unknown as typeof fetch;
    const out = await onedriveConnector({
      access_token: "placeholder", selected_item_ids: files.map((file) => file.id),
    }, fetchFn).fetch({}, previous);
    expect(out.nextCursor).toEqual(previous);
  });

  it("retains the previous SharePoint cursor when a site children page is capped", async () => {
    const files = Array.from({ length: 50 }, (_, index) => ({
      id: `file-${index}`, name: `file-${index}.txt`, file: { mimeType: "text/plain" },
      lastModifiedDateTime: "2026-07-10T00:00:00.000Z",
    }));
    const fetchFn = vi.fn(async (url: string | URL | Request) => String(url).endsWith("/content")
      ? new Response("content", { status: 200 })
      : new Response(JSON.stringify({ value: files }), {
          status: 200, headers: { "content-type": "application/json" },
        })) as unknown as typeof fetch;
    const out = await sharepointConnector({
      access_token: "placeholder", selected_site_ids: ["site-1"],
    }, fetchFn).fetch({}, previous);
    expect(out.nextCursor).toEqual(previous);
  });

  it("retains the previous Teams cursor when a channel message page is capped", async () => {
    const messages = Array.from({ length: 20 }, (_, index) => ({
      id: `message-${index}`, createdDateTime: "2026-07-10T00:00:00.000Z", body: { content: `Decision ${index}` },
    }));
    const fetchFn = vi.fn(async (url: string | URL | Request) => new Response(JSON.stringify({
      value: String(url).includes("/replies") ? [] : messages,
    }), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
    const out = await microsoftTeamsConnector({
      access_token: "placeholder",
      selected_channels: [{ team_id: "team-1", channel_id: "channel-1" }],
    }, fetchFn).fetch({}, previous);
    expect(out.nextCursor).toEqual(previous);
  });

  it("retains the previous Outlook cursor when a message page is capped", async () => {
    const messages = Array.from({ length: 50 }, (_, index) => ({
      id: `message-${index}`, conversationId: `conversation-${index}`,
      receivedDateTime: "2026-07-10T00:00:00.000Z", body: { content: `Decision ${index}` },
    }));
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ value: messages }), {
      status: 200, headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
    const out = await outlookConnector({
      access_token: "placeholder", selected_mailbox: "me", selected_folder_ids: ["inbox"],
    }, fetchFn).fetch({}, previous);
    expect(out.nextCursor).toEqual(previous);
  });

  it("retains the previous Zoom cursor when a recordings page is capped", async () => {
    const meetings = Array.from({ length: 25 }, (_, index) => ({ uuid: `meeting-${index}` }));
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ meetings }), {
      status: 200, headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
    const out = await zoomConnector({ access_token: "placeholder" }, fetchFn).fetch({}, previous);
    expect(out.nextCursor).toEqual(previous);
  });
});

describe("live fetch shape", () => {
  it("notion connector filters selected pages by watermark and pulls block text", async () => {
    const calls: string[] = [];
    const fetchFn = (async (url: any, init?: any) => {
      calls.push(String(url));
      const body = String(url).endsWith("/pages/new")
        ? { id: "new", url: "https://n/new", last_edited_time: "2026-07-10T00:00:00.000Z", last_edited_by: { id: "u1" }, properties: { t: { type: "title", title: [{ plain_text: "Fresh" }] } } }
        : String(url).endsWith("/pages/old")
          ? { id: "old", url: "https://n/old", last_edited_time: "2020-01-01T00:00:00.000Z", properties: {} }
          : { results: [{ type: "paragraph", paragraph: { rich_text: [{ plain_text: "content" }] } }], has_more: false };
      expect(init?.headers?.["Notion-Version"] ?? init?.headers?.["notion-version"]).toBeDefined();
      return { ok: true, json: async () => body } as any;
    }) as unknown as typeof fetch;
    const out = await notionConnector({ access_token: "tok", selected_page_ids: ["new", "old"] }, fetchFn)
      .fetch({}, { updated_since: "2026-07-01T00:00:00.000Z" });
    expect(out.items).toHaveLength(1);
    expect(out.items[0].title).toBe("Fresh");
    expect(calls.filter((u) => u.includes("/blocks/"))).toHaveLength(1);
    expect((out.nextCursor as any).updated_since).toBeDefined();
  });
});
