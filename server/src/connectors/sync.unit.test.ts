import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getConnector: vi.fn(),
  upsertConnector: vi.fn(),
  persistConnectorSync: vi.fn(),
  filterThreads: vi.fn(),
  aggregate: vi.fn(),
  buildConnector: vi.fn(),
}));

vi.mock("./repo.js", () => ({
  getConnector: mocks.getConnector,
  upsertConnector: mocks.upsertConnector,
  persistConnectorSync: mocks.persistConnectorSync,
  insertEvidence: vi.fn(),
}));
vi.mock("./tokenRefresh.js", () => ({ ensureFreshCredentials: vi.fn() }));
vi.mock("./junkFilter.js", () => ({ filterThreads: mocks.filterThreads }));
vi.mock("./extract.js", () => ({ extractThread: vi.fn() }));
vi.mock("./aggregate.js", () => ({ aggregate: mocks.aggregate }));
vi.mock("../db/embed.js", () => ({ embed: vi.fn() }));
// Only the adapter factory is stubbed; isSyncableType stays real so the
// supported-source check under test is the shipped one.
vi.mock("./adapters/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./adapters/index.js")>()),
  buildConnector: mocks.buildConnector,
}));
vi.mock("../llm/complete.js", () => ({ defaultLlm: vi.fn() }));

import { fetchSelectionContext, supportsSelectionContent } from "./selectionContent.js";
import { syncConnector } from "./sync.js";
import { ensureFreshCredentials } from "./tokenRefresh.js";
import type { Connector } from "./types.js";

describe("sync connector failure boundary", () => {
  it("does not restore a cursor when disconnect wins after adapter fetch", async () => {
    mocks.getConnector.mockResolvedValue({
      id: "connector-1", type: "notion", status: "connected", credentials: { access_token: "token" }, settings: {}, cursor: { old: "cursor" },
    });
    mocks.persistConnectorSync.mockResolvedValue(false);
    mocks.filterThreads.mockReturnValue([]);
    mocks.aggregate.mockResolvedValue({ skills: 0, contexts: 0 });
    const connector: Connector = { type: "notion", fetch: vi.fn(async () => ({ items: [], nextCursor: { new: "cursor" } })) };
    const llm = { complete: vi.fn() };

    await expect(syncConnector("notion", { connector, llm })).resolves.toMatchObject({ fetched: 0 });
    expect(mocks.persistConnectorSync).toHaveBeenCalledWith("connector-1", "notion", expect.objectContaining({ cursor: { new: "cursor" } }));
    expect(mocks.upsertConnector).not.toHaveBeenCalled();
  });

  it("rejects disabled connectors before an adapter can fetch", async () => {
    mocks.getConnector.mockResolvedValue({
      id: "connector-1", type: "notion", status: "disabled", credentials: { access_token: "token" }, cursor: {}, settings: {},
    });
    const connector: Connector = { type: "notion", fetch: vi.fn() };

    await expect(syncConnector("notion", { connector, llm: { complete: vi.fn() } }))
      .rejects.toThrow("connector notion is not connected");
    expect(connector.fetch).not.toHaveBeenCalled();
  });

  it("merges saved selection settings into credentials passed to adapters", async () => {
    mocks.getConnector.mockResolvedValue({
      id: "connector-1", type: "notion", status: "connected", credentials: { access_token: "token" },
      settings: { selected_page_ids: ["page-1"], access_token: "tampered" }, cursor: {},
    });
    const connector: Connector = {
      type: "notion",
      fetch: vi.fn(async (credentials) => {
        expect(credentials).toEqual({ access_token: "token", selected_page_ids: ["page-1"] });
        throw new Error("stop after credential assertion");
      }),
    };

    await expect(syncConnector("notion", { connector, llm: { complete: vi.fn() } }))
      .rejects.toThrow("stop after credential assertion");
  });

  it("does not persist a replacement cursor when its adapter fetch rejects", async () => {
    const previous = { updated_since: "2026-07-01T00:00:00.000Z" };
    mocks.getConnector.mockResolvedValue({
      id: "connector-1", type: "notion", status: "connected", credentials: { access_token: "token" }, settings: {}, cursor: previous,
    });
    const connector: Connector = {
      type: "notion",
      fetch: vi.fn(async () => { throw new Error("api.notion.com request failed (503)"); }),
    };

    await expect(syncConnector("notion", { connector, llm: { complete: vi.fn() } }))
      .rejects.toThrow("api.notion.com request failed (503)");

    expect(mocks.upsertConnector).not.toHaveBeenCalled();
  });
});

describe("selection content for grounded interviews", () => {
  const json = (body: unknown) => new Response(JSON.stringify(body), {
    status: 200, headers: { "content-type": "application/json" },
  });

  it("supports every syncable source and rejects unconnected ones", async () => {
    expect(supportsSelectionContent("notion")).toBe(true);
    expect(supportsSelectionContent("gmail")).toBe(true);
    expect(supportsSelectionContent("jira")).toBe(true);
    expect(supportsSelectionContent("carrier-pigeon")).toBe(false);
    mocks.getConnector.mockResolvedValue(null);
    await expect(fetchSelectionContext("notion")).rejects.toMatchObject({ code: "source_not_connected" });
    mocks.getConnector.mockResolvedValue({ id: "c1", type: "notion", status: "disabled", credentials: {}, settings: {} });
    await expect(fetchSelectionContext("notion")).rejects.toMatchObject({ code: "source_not_connected" });
  });

  it("maps a missing saved selection to selection_required", async () => {
    mocks.getConnector.mockResolvedValue({
      id: "c1", type: "notion", status: "connected", credentials: { access_token: "token" }, settings: {},
    });
    vi.mocked(ensureFreshCredentials).mockResolvedValue({ access_token: "token" });
    await expect(fetchSelectionContext("notion", vi.fn() as unknown as typeof fetch))
      .rejects.toMatchObject({ code: "selection_required" });
  });

  it("snapshots selected page content live from the source", async () => {
    mocks.getConnector.mockResolvedValue({
      id: "c1", type: "notion", status: "connected", credentials: { access_token: "token" },
      settings: { selected_page_ids: ["page-1"], selected_data_source_ids: [] },
    });
    vi.mocked(ensureFreshCredentials).mockResolvedValue({ access_token: "token" });
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const value = String(url);
      if (value.endsWith("/v1/pages/page-1")) {
        return json({
          object: "page", id: "page-1", url: "https://www.notion.so/page-1",
          properties: { Name: { type: "title", title: [{ plain_text: "Refund Runbook" }] } },
        });
      }
      if (value.includes("/blocks/page-1/")) {
        return json({
          results: [{ object: "block", id: "b1", type: "paragraph", paragraph: { rich_text: [{ plain_text: "Refunds under $200 are automatic." }] } }],
          has_more: false,
        });
      }
      throw new Error(`unexpected URL ${value}`);
    }) as unknown as typeof fetch;

    const context = await fetchSelectionContext("notion", fetchFn);
    expect(context.source_type).toBe("notion");
    expect(Date.parse(context.fetched_at)).not.toBeNaN();
    expect(context.documents).toEqual([{
      title: "Refund Runbook",
      url: "https://www.notion.so/page-1",
      text: "Refunds under $200 are automatic.",
    }]);
  });

  it("grounds a source without a picker on its sync adapter's recent items", async () => {
    mocks.getConnector.mockResolvedValue({
      id: "c2", type: "linear", status: "connected", credentials: { access_token: "token" }, settings: {},
    });
    vi.mocked(ensureFreshCredentials).mockResolvedValue({ access_token: "token" });
    mocks.buildConnector.mockReturnValue({
      type: "linear",
      fetch: vi.fn(async () => ({
        items: [
          {
            thread_id: "linear:OPS-1", permalink: "https://linear.app/OPS-1", title: "Escalation policy",
            participants: [], messages: [{ from: "maya", ts: "", text: "Page the on-call after 15 minutes." }],
          },
          // Nothing readable: an empty pack must not be passed off as grounding.
          { thread_id: "linear:OPS-2", permalink: "", participants: [], messages: [] },
        ],
        nextCursor: {},
      })),
    });

    const context = await fetchSelectionContext("linear", vi.fn() as unknown as typeof fetch);
    expect(mocks.buildConnector).toHaveBeenCalledWith("linear", expect.objectContaining({ access_token: "token" }));
    expect(context.source_type).toBe("linear");
    expect(context.documents).toEqual([{
      title: "Escalation policy",
      url: "https://linear.app/OPS-1",
      text: "maya: Page the on-call after 15 minutes.",
    }]);
  });
});
