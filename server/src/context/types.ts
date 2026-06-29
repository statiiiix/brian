export type ContextStatus = "active" | "retired";

export interface ContextEntry {
  id: string;
  content: string;
  summary: string | null;
  tags: string[];
  source: string | null;
  status: ContextStatus;
  owner: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface NewContext {
  content: string;
  summary: string | null;
  tags: string[];
  source: string | null;
  owner: string | null;
}

export interface ContextVersion {
  id: string;
  context_id: string;
  version: number;
  snapshot: ContextEntry;
  changed_by: string | null;
  created_at: string;
}
