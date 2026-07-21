import { describe, expect, it } from "vitest";
import { parseNotionSettings, publicNotionSettings } from "./notionSettings.js";

describe("Notion selection settings", () => {
  it("accepts only deduplicated non-empty selected resource IDs", () => {
    expect(parseNotionSettings({
      selected_page_ids: [" page-1 ", "page-1"],
      selected_data_source_ids: ["source-1"],
    })).toEqual({ selected_page_ids: ["page-1"], selected_data_source_ids: ["source-1"] });
  });

  it.each([
    {},
    { selected_page_ids: [] },
    { selected_page_ids: [" "] },
    { selected_page_ids: ["page-1"] },
    { selected_page_ids: "page-1", selected_data_source_ids: [] },
    { selected_page_ids: ["page-1"], extra: true },
  ])("rejects malformed or empty selection payloads", (value) => {
    expect(() => parseNotionSettings(value)).toThrow("invalid Notion selection");
  });

  it("redacts unknown settings keys from public connector responses", () => {
    expect(publicNotionSettings({ selected_page_ids: ["page-1"], access_token: "secret" }))
      .toEqual({ selected_page_ids: ["page-1"], selected_data_source_ids: [] });
  });
});
