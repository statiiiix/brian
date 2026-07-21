const SETTING_KEYS = new Set(["selected_page_ids", "selected_data_source_ids"]);
export const MAX_NOTION_SELECTIONS = 100;

export interface NotionSettings {
  selected_page_ids: string[];
  selected_data_source_ids: string[];
}

function ids(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((id) => typeof id !== "string" || !id.trim())) {
    throw new Error("invalid Notion selection");
  }
  return [...new Set(value.map((id) => id.trim()))];
}

export function parseNotionSettings(value: unknown): NotionSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== SETTING_KEYS.size
    || [...SETTING_KEYS].some((key) => !(key in value))
    || Object.keys(value).some((key) => !SETTING_KEYS.has(key))) {
    throw new Error("invalid Notion selection");
  }
  const candidate = value as Record<string, unknown>;
  const selected_page_ids = ids(candidate.selected_page_ids);
  const selected_data_source_ids = ids(candidate.selected_data_source_ids);
  if (!selected_page_ids.length && !selected_data_source_ids.length
    || selected_page_ids.length + selected_data_source_ids.length > MAX_NOTION_SELECTIONS) {
    throw new Error("invalid Notion selection");
  }
  return { selected_page_ids, selected_data_source_ids };
}

export function publicNotionSettings(value: unknown): NotionSettings {
  const candidate = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  const safeIds = (setting: string) => Array.isArray(candidate[setting])
    ? [...new Set(candidate[setting].filter((id): id is string => typeof id === "string" && !!id.trim()).map((id) => id.trim()))]
    : [];
  return {
    selected_page_ids: safeIds("selected_page_ids"),
    selected_data_source_ids: safeIds("selected_data_source_ids"),
  };
}
