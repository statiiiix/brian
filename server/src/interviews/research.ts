import OpenAI from "openai";
import { secret } from "../config/secrets.js";
import { LLM_MODEL } from "../llm/complete.js";

export interface WebCitation {
  title: string;
  url: string;
  retrieved_at: string;
}

export interface ResearchResult {
  summary: string;
  citations: WebCitation[];
}

export interface ResearchClient {
  search(query: string): Promise<ResearchResult>;
}

type ResponseCreate = (request: any) => Promise<any>;

export function createResearchClient(
  create: ResponseCreate,
  model = LLM_MODEL,
  now: () => string = () => new Date().toISOString(),
): ResearchClient {
  return {
    async search(query) {
      const response = await create({
        model,
        // Hosted `web_search`, not the legacy `web_search_preview`: preview
        // ignores tool controls and costs more on non-reasoning models.
        tools: [{ type: "web_search" }],
        input: [
          {
            role: "system",
            content: `Research one bounded factual or methodological gap for a business skill.
Prefer authoritative primary sources. Summarize only what the sources support. Public guidance
is not company policy and must be presented as external research.`,
          },
          { role: "user", content: query },
        ],
      });
      const citations = new Map<string, WebCitation>();
      for (const item of response.output ?? []) {
        if (item.type !== "message") continue;
        for (const content of item.content ?? []) {
          if (content.type !== "output_text") continue;
          for (const annotation of content.annotations ?? []) {
            if (annotation.type !== "url_citation" || citations.has(annotation.url)) continue;
            citations.set(annotation.url, {
              title: annotation.title,
              url: annotation.url,
              retrieved_at: now(),
            });
          }
        }
      }
      const summary = String(response.output_text ?? "").trim();
      if (!summary) throw new Error("web research returned no summary");
      return { summary, citations: [...citations.values()] };
    },
  };
}

let client: OpenAI | null = null;
async function openai(): Promise<OpenAI> {
  if (!client) client = new OpenAI({ apiKey: await secret("OPENAI_API_KEY") });
  return client;
}

export function defaultResearchClient(): ResearchClient {
  return {
    async search(query) {
      const model = (await secret("LLM_MODEL")) ?? LLM_MODEL;
      return createResearchClient(
        async (request) => (await openai()).responses.create(request), model,
      ).search(query);
    },
  };
}
