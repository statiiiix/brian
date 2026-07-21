import { describe, expect, it, vi } from "vitest";
import { MAX_ITEMS_PER_SYNC, MAX_TEXT_LENGTH } from "./common.js";
import { discoverNotionBoundaries, notionConnector, readNotionSelectionDocuments, revokeNotionToken } from "./notion.js";

const previous = { updated_since: "2026-07-01T00:00:00.000Z" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" },
});
const page = (id: string, extra: Record<string, unknown> = {}) => ({
  object: "page",
  id,
  url: `https://www.notion.so/${id}`,
  last_edited_time: "2026-07-10T00:00:00.000Z",
  last_edited_by: { id: "editor-1" },
  properties: { Name: { type: "title", title: [{ plain_text: `Title ${id}` }] } },
  ...extra,
});
const block = (id: string, text: string, extra: Record<string, unknown> = {}) => ({
  object: "block", id, type: "paragraph", paragraph: { rich_text: [{ plain_text: text }] }, ...extra,
});

describe("Notion current-API adapter", () => {
  it("revokes a Notion token with protected-client Basic auth and fails closed", async () => {
    let request: { url: string; init?: RequestInit } | undefined;
    await expect(revokeNotionToken("access-token", { clientId: "client-id", clientSecret: "client-secret" }, async (url, init) => {
      request = { url: String(url), init };
      return new Response(null, { status: 204 });
    })).resolves.toBeUndefined();
    expect(request?.url).toBe("https://api.notion.com/v1/oauth/revoke");
    expect(new Headers(request?.init?.headers).get("authorization")).toMatch(/^Basic /);
    expect(new Headers(request?.init?.headers).get("Notion-Version")).toBe("2026-03-11");
    expect(request?.init?.body).toBe(JSON.stringify({ token: "access-token" }));

    await expect(revokeNotionToken("access-token", { clientId: "client-id", clientSecret: "client-secret" }, async () => new Response(
      JSON.stringify({ message: "private provider response" }), { status: 401 },
    ))).rejects.toThrow("notion_revocation_failed");
  });

  it("discovers bounded page and data-source boundaries with opaque pagination", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      const body = JSON.parse(String(init?.body));
      if (body.filter.value === "page") {
        return body.start_cursor
          ? json({ results: [{ object: "page", id: "page-2", url: "https://notion.so/page-2", properties: { Name: { type: "title", title: [{ plain_text: "Second" }] } } }], has_more: false, next_cursor: null })
          : json({ results: [{ object: "page", id: "page-1", url: "https://notion.so/page-1", properties: { Name: { type: "title", title: [{ plain_text: "First" }] } } }, { object: "page", id: "trashed", in_trash: true }], has_more: true, next_cursor: "opaque-page-cursor" });
      }
      return json({ results: [{ object: "data_source", id: "source-1", url: "https://notion.so/source-1", title: [{ plain_text: "Projects" }] }], has_more: false, next_cursor: null });
    }) as unknown as typeof fetch;

    await expect(discoverNotionBoundaries({ access_token: "token" }, fetchFn, 3)).resolves.toEqual({
      boundaries: [
        { id: "page-1", kind: "page", title: "First", permalink: "https://notion.so/page-1" },
        { id: "page-2", kind: "page", title: "Second", permalink: "https://notion.so/page-2" },
        { id: "source-1", kind: "data_source", title: "Projects", permalink: "https://notion.so/source-1" },
      ],
      truncated: false,
    });
    expect(calls).toHaveLength(3);
    expect(calls.every(({ url, init }) => url === "https://api.notion.com/v1/search"
      && (init?.headers as Record<string, string>)["Notion-Version"] === "2026-03-11")).toBe(true);
  });

  it.each([
    { response: { results: [], has_more: true }, message: "pagination cursor is missing" },
    { response: { results: [], has_more: true, next_cursor: "repeated" }, message: "pagination cursor repeated" },
  ])("fails closed when boundary search $message", async ({ response, message }) => {
    let calls = 0;
    const fetchFn = vi.fn(async () => {
      calls++;
      return json(calls === 1 ? response : response);
    }) as unknown as typeof fetch;
    if (message.includes("repeated")) {
      await expect(discoverNotionBoundaries({ access_token: "token" }, async () => {
        calls++;
        return json(calls === 1 ? response : response);
      }, 10)).rejects.toThrow(message);
    } else {
      await expect(discoverNotionBoundaries({ access_token: "token" }, fetchFn, 10)).rejects.toThrow(message);
    }
  });

  it("signals truncation rather than claiming a boundary search is complete at its limit", async () => {
    const fetchFn = vi.fn(async () => json({
      results: [{ object: "page", id: "page-1", properties: { Name: { type: "title", title: [{ plain_text: "One" }] } } }],
      has_more: true, next_cursor: "opaque-next",
    })) as unknown as typeof fetch;
    await expect(discoverNotionBoundaries({ access_token: "token" }, fetchFn, 1)).resolves.toEqual({
      boundaries: [{ id: "page-1", kind: "page", title: "One", permalink: "https://www.notion.so/page1" }], truncated: true,
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("deduplicates and skips trashed boundary search results", async () => {
    const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const kind = JSON.parse(String(init?.body)).filter.value;
      return json(kind === "page"
        ? { results: [
          { object: "page", id: "page-1", properties: { Name: { type: "title", title: [{ plain_text: "One" }] } } },
          { object: "page", id: "page-1", properties: { Name: { type: "title", title: [{ plain_text: "Duplicate" }] } } },
          { object: "page", id: "deleted", in_trash: true },
        ], has_more: false }
        : { results: [], has_more: false });
    }) as unknown as typeof fetch;
    await expect(discoverNotionBoundaries({ access_token: "token" }, fetchFn, 10)).resolves.toEqual({
      boundaries: [{ id: "page-1", kind: "page", title: "One", permalink: "https://www.notion.so/page1" }], truncated: false,
    });
  });

  it.each([
    [{ access_token: "token" }],
    [{ access_token: "token", selected_page_ids: ["page-1", 4] }],
    [{ access_token: "token", selected_data_source_ids: "data-source-1" }],
  ])("fails closed before fetch for absent or malformed selections", async (creds) => {
    const fetchFn = vi.fn(async () => { throw new Error("provider request must not run"); }) as unknown as typeof fetch;

    await expect(notionConnector(creds, fetchFn).fetch({}, previous))
      .rejects.toThrow("explicit saved resource selection is required");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("uses the current version header and directly reads only selected pages", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return String(url).includes("/children") ? json({ results: [block("top", "Selected content")], has_more: false }) : json(page("page-1"));
    }) as unknown as typeof fetch;

    const out = await notionConnector({ access_token: "token", selected_page_ids: ["page-1"] }, fetchFn).fetch({}, previous);

    expect(out.items).toMatchObject([{ thread_id: "page-1", title: "Title page-1", permalink: "https://www.notion.so/page-1" }]);
    expect(out.items[0].messages[0].text).toBe("Selected content");
    expect(calls.map(({ url }) => url)).toEqual([
      "https://api.notion.com/v1/pages/page-1",
      "https://api.notion.com/v1/blocks/page-1/children?page_size=100",
    ]);
    expect(calls.every(({ init }) => (init?.headers as Record<string, string>)["Notion-Version"] === "2026-03-11")).toBe(true);
  });

  it("paginates each selected data source with opaque cursors", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const value = String(url); calls.push({ url: value, init });
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (value.includes("data_sources")) return body.start_cursor === "opaque-query-cursor"
        ? json({ results: [page("row-2")], has_more: false, next_cursor: null })
        : json({ results: [page("row-1")], has_more: true, next_cursor: "opaque-query-cursor" });
      if (value.includes("/children")) return json({ results: [block(`block-${calls.length}`, "row text")], has_more: false });
      throw new Error(`unexpected URL ${value}`);
    }) as unknown as typeof fetch;

    const out = await notionConnector({ access_token: "token", selected_data_source_ids: ["source-1"] }, fetchFn).fetch({}, previous);

    expect(out.items.map((item) => item.thread_id)).toEqual(["row-1", "row-2"]);
    expect(calls.filter(({ url }) => url.includes("data_sources/source-1/query")).map(({ url, init }) => ({ url, body: JSON.parse(String(init?.body)) }))).toEqual([
      { url: "https://api.notion.com/v1/data_sources/source-1/query", body: { page_size: MAX_ITEMS_PER_SYNC, result_type: "page", filter: { timestamp: "last_edited_time", last_edited_time: { on_or_after: previous.updated_since } }, sorts: [{ timestamp: "last_edited_time", direction: "ascending" }] } },
      { url: "https://api.notion.com/v1/data_sources/source-1/query", body: { page_size: MAX_ITEMS_PER_SYNC - 1, result_type: "page", filter: { timestamp: "last_edited_time", last_edited_time: { on_or_after: previous.updated_since } }, sorts: [{ timestamp: "last_edited_time", direction: "ascending" }], start_cursor: "opaque-query-cursor" } },
    ]);
  });

  it("paginates and recursively reads non-trashed child blocks with a bounded result", async () => {
    const urls: string[] = [];
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const value = String(url); urls.push(value);
      if (value.endsWith("/v1/pages/page-1")) return json(page("page-1"));
      if (value.includes("blocks/page-1/children")) return value.includes("opaque-block-cursor")
        ? json({ results: [block("second", "Second")], has_more: false })
        : json({ results: [block("parent", "First", { has_children: true })], has_more: true, next_cursor: "opaque-block-cursor" });
      if (value.includes("blocks/parent/children")) return json({ results: [block("nested", "Nested")], has_more: false });
      throw new Error(`unexpected URL ${value}`);
    }) as unknown as typeof fetch;

    const out = await notionConnector({ access_token: "token", selected_page_ids: ["page-1"] }, fetchFn).fetch({}, previous);

    expect(out.items[0].messages[0].text).toBe("First\nNested\nSecond");
    expect(urls).toContain("https://api.notion.com/v1/blocks/page-1/children?page_size=100&start_cursor=opaque-block-cursor");
    expect(urls).toContain("https://api.notion.com/v1/blocks/parent/children?page_size=100");
    expect(out.items[0].messages[0].text.length).toBeLessThanOrEqual(MAX_TEXT_LENGTH);
  });

  it("rejects a recursive block cycle instead of returning partial evidence", async () => {
    let parentReads = 0;
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const value = String(url);
      if (value.endsWith("/v1/pages/page-1")) return json(page("page-1"));
      if (value.includes("blocks/page-1/children")) return json({ results: [block("parent", "Top", { has_children: true })], has_more: false });
      if (value.includes("blocks/parent/children")) {
        parentReads++;
        return parentReads === 1
          ? json({ results: [block("parent", "Cycle", { has_children: true })], has_more: false })
          : json({ results: [], has_more: false });
      }
      throw new Error(`unexpected URL ${value}`);
    }) as unknown as typeof fetch;

    await expect(notionConnector({ access_token: "token", selected_page_ids: ["page-1"] }, fetchFn).fetch({}, previous))
      .rejects.toThrow("api.notion.com block traversal is incomplete");
    expect(parentReads).toBe(1);
  });

  it("rejects oversized and over-deep block traversals", async () => {
    const oversized = vi.fn(async (url: string | URL | Request) => String(url).endsWith("/v1/pages/page-1")
      ? json(page("page-1"))
      : json({ results: Array.from({ length: 1_001 }, (_, index) => block(`block-${index}`, "text")), has_more: false })) as unknown as typeof fetch;
    await expect(notionConnector({ access_token: "token", selected_page_ids: ["page-1"] }, oversized).fetch({}, previous))
      .rejects.toThrow("api.notion.com block traversal is incomplete");

    let depth = 0;
    const deep = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith("/v1/pages/page-1")) return json(page("page-1"));
      return json({ results: [block(`child-${depth++}`, "text", { has_children: true })], has_more: false });
    }) as unknown as typeof fetch;
    await expect(notionConnector({ access_token: "token", selected_page_ids: ["page-1"] }, deep).fetch({}, previous))
      .rejects.toThrow("api.notion.com block traversal is incomplete");
  });

  it("rejects incomplete provider responses without returning evidence", async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => String(url).endsWith("/v1/pages/page-1")
      ? json({ request_status: { type: "incomplete" } })
      : json({ results: [], has_more: false })) as unknown as typeof fetch;

    await expect(notionConnector({ access_token: "token", selected_page_ids: ["page-1"] }, fetchFn).fetch({}, previous))
      .rejects.toThrow("api.notion.com request was incomplete");
  });

  it("rejects an incomplete data-source query before returning a cursor", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return json({ request_status: { type: "incomplete" } });
    }) as unknown as typeof fetch;

    await expect(notionConnector({ access_token: "token", selected_data_source_ids: ["source-1"] }, fetchFn).fetch({}, previous))
      .rejects.toThrow("api.notion.com request was incomplete");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: "https://api.notion.com/v1/data_sources/source-1/query",
      init: { method: "POST" },
    });
  });

  it("rejects repeated opaque query and block cursors", async () => {
    const queryFetch = vi.fn(async () => json({ results: [], has_more: true, next_cursor: "same-cursor" })) as unknown as typeof fetch;
    await expect(notionConnector({ access_token: "token", selected_data_source_ids: ["source-1"] }, queryFetch).fetch({}, previous))
      .rejects.toThrow("api.notion.com pagination cursor repeated");

    const blockFetch = vi.fn(async (url: string | URL | Request) => String(url).endsWith("/v1/pages/page-1")
      ? json(page("page-1"))
      : json({ results: [], has_more: true, next_cursor: "same-cursor" })) as unknown as typeof fetch;
    await expect(notionConnector({ access_token: "token", selected_page_ids: ["page-1"] }, blockFetch).fetch({}, previous))
      .rejects.toThrow("api.notion.com pagination cursor repeated");
  });

  it("excludes trashed pages and blocks", async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const value = String(url);
      if (value.endsWith("/v1/pages/trashed")) return json(page("trashed", { in_trash: true }));
      if (value.endsWith("/v1/pages/kept")) return json(page("kept"));
      if (value.includes("blocks/kept/children")) return json({ results: [block("gone", "do not store", { in_trash: true }), block("kept-block", "safe")], has_more: false });
      throw new Error(`unexpected URL ${value}`);
    }) as unknown as typeof fetch;

    const out = await notionConnector({ access_token: "token", selected_page_ids: ["trashed", "kept"] }, fetchFn).fetch({}, previous);

    expect(out.items.map((item) => item.thread_id)).toEqual(["kept"]);
    expect(out.items[0].messages[0].text).toBe("safe");
  });

  it.each([
    ["selected page", { selected_page_ids: ["page-1"] }, (url: string) => url.includes("/v1/pages/")],
    ["data-source query", { selected_data_source_ids: ["source-1"] }, (url: string) => url.includes("data_sources")],
    ["block pagination", { selected_page_ids: ["page-1"] }, (url: string) => url.includes("start_cursor")],
    ["nested block", { selected_page_ids: ["page-1"] }, (url: string) => url.includes("blocks/parent/children")],
  ])("rejects %s failures without yielding a new cursor", async (_name, selection, fails) => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const value = String(url);
      if (fails(value)) return json({ private: "provider response must never surface" }, 503);
      if (value.includes("data_sources")) return json({ results: [page("row-1")], has_more: false });
      if (value.endsWith("/v1/pages/page-1")) return json(page("page-1"));
      if (value.includes("blocks/page-1/children")) return json({ results: [block("parent", "Top", { has_children: true })], has_more: true, next_cursor: "opaque" });
      if (value.includes("blocks/parent/children")) return json({ results: [], has_more: false });
      throw new Error(`unexpected URL ${value}`);
    }) as unknown as typeof fetch;

    await expect(notionConnector({ access_token: "token", ...selection }, fetchFn).fetch({}, previous))
      .rejects.toThrow("api.notion.com request failed (503)");
  });

  it("resumes selected-page boundaries after a capped read and advances at an exact terminal cap", async () => {
    const selected_page_ids = Array.from({ length: MAX_ITEMS_PER_SYNC + 1 }, (_, index) => `page-${index}`);
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const value = String(url);
      return value.includes("/children") ? json({ results: [], has_more: false }) : json(page(value.split("/").pop()!));
    }) as unknown as typeof fetch;

    const connector = notionConnector({ access_token: "token", selected_page_ids }, fetchFn);
    const out = await connector.fetch({}, previous);

    expect(out.items).toHaveLength(MAX_ITEMS_PER_SYNC);
    expect(out.nextCursor).toMatchObject({
      updated_since: previous.updated_since,
      notion_resume: {
        selection_fingerprint: JSON.stringify({ page_ids: selected_page_ids, data_source_ids: [] }),
        page_index: MAX_ITEMS_PER_SYNC,
        data_source_index: 0,
      },
    });
    const resumed = await connector.fetch({}, out.nextCursor);
    expect(resumed.items.map((item) => item.thread_id)).toEqual([`page-${MAX_ITEMS_PER_SYNC}`]);
    expect(resumed.nextCursor).not.toHaveProperty("notion_resume");

    const terminalIds = Array.from({ length: MAX_ITEMS_PER_SYNC }, (_, index) => `terminal-${index}`);
    const terminal = await notionConnector({ access_token: "token", selected_page_ids: terminalIds }, fetchFn).fetch({}, previous);
    expect(terminal.nextCursor).not.toHaveProperty("notion_resume");
  });

  it("resumes a paginated data source with its provider cursor", async () => {
    const rows = Array.from({ length: MAX_ITEMS_PER_SYNC }, (_, index) => page(`row-${index}`));
    const calls: RequestInit[] = [];
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const value = String(url);
      if (value.includes("data_sources")) {
        calls.push(init!);
        return JSON.parse(String(init?.body)).start_cursor === "resume-token"
          ? json({ results: [page("row-final")], has_more: false })
          : json({ results: rows, has_more: true, next_cursor: "resume-token" });
      }
      return json({ results: [], has_more: false });
    }) as unknown as typeof fetch;
    const connector = notionConnector({ access_token: "token", selected_data_source_ids: ["source-1"] }, fetchFn);

    const out = await connector.fetch({}, previous);
    expect(out.items).toHaveLength(MAX_ITEMS_PER_SYNC);
    expect(out.nextCursor).toMatchObject({ notion_resume: { data_source_index: 0, data_source_cursor: "resume-token" } });
    const resumed = await connector.fetch({}, out.nextCursor);
    expect(resumed.items.map((item) => item.thread_id)).toEqual(["row-final"]);
    expect(JSON.parse(String(calls[1].body))).toMatchObject({ page_size: MAX_ITEMS_PER_SYNC, start_cursor: "resume-token" });
  });

  it("rejects non-page data-source results", async () => {
    const fetchFn = vi.fn(async () => json({ results: [{ object: "data_source", id: "not-a-page" }], has_more: false })) as unknown as typeof fetch;
    await expect(notionConnector({ access_token: "token", selected_data_source_ids: ["source-1"] }, fetchFn).fetch({}, previous))
      .rejects.toThrow("api.notion.com query returned a non-page result");
  });

  it("uses the sync-start checkpoint rather than a later wall-clock time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-19T10:00:00.000Z"));
    try {
      const fetchFn = vi.fn(async (url: string | URL | Request) => {
        const value = String(url);
        if (value.endsWith("/v1/pages/page-1")) {
          vi.setSystemTime(new Date("2026-07-19T10:05:00.000Z"));
          return json(page("page-1"));
        }
        if (value.includes("/children")) return json({ results: [], has_more: false });
        throw new Error(`unexpected URL ${value}`);
      }) as unknown as typeof fetch;

      const out = await notionConnector({ access_token: "token", selected_page_ids: ["page-1"] }, fetchFn).fetch({}, previous);

      expect(out.nextCursor).toEqual({ updated_since: "2026-07-19T10:00:00.000Z" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("reads selected pages and data-source pages as bounded documents", async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const value = String(url);
      if (value.endsWith("/v1/pages/page-1")) return json(page("page-1"));
      if (value.includes("/v1/data_sources/source-1/query")) {
        expect(JSON.parse(String(init?.body)).sorts).toEqual([{ timestamp: "last_edited_time", direction: "descending" }]);
        return json({ results: [page("page-2"), page("page-1")], has_more: false });
      }
      if (value.includes("/blocks/page-1/")) return json({ results: [block("b1", "Page one body")], has_more: false });
      if (value.includes("/blocks/page-2/")) return json({ results: [block("b2", "Page two body")], has_more: false });
      throw new Error(`unexpected URL ${value}`);
    }) as unknown as typeof fetch;

    const documents = await readNotionSelectionDocuments({
      access_token: "token",
      selected_page_ids: ["page-1"],
      selected_data_source_ids: ["source-1"],
    }, fetchFn);

    expect(documents).toEqual([
      { title: "Title page-1", url: "https://www.notion.so/page-1", text: "Page one body" },
      { title: "Title page-2", url: "https://www.notion.so/page-2", text: "Page two body" },
    ]);
  });

  it("requires a saved selection and caps document count", async () => {
    await expect(readNotionSelectionDocuments({ access_token: "token" }, vi.fn() as unknown as typeof fetch))
      .rejects.toThrow("explicit saved resource selection is required");

    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const value = String(url);
      const match = value.match(/\/v1\/pages\/(page-\d+)/);
      if (match) return json(page(match[1]));
      if (value.includes("/children")) return json({ results: [block("b", "body")], has_more: false });
      throw new Error(`unexpected URL ${value}`);
    }) as unknown as typeof fetch;
    const documents = await readNotionSelectionDocuments(
      { access_token: "token", selected_page_ids: ["page-1", "page-2", "page-3"] },
      fetchFn,
      { maxDocuments: 2 },
    );
    expect(documents).toHaveLength(2);
  });
});
