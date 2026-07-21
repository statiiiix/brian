import OpenAI from "openai";
import { secret } from "../config/secrets.js";

// Single seam for all generative LLM calls (skill drafting, interviews, capture).
// Provider is OpenAI through the Responses API — the API OpenAI recommends for
// reasoning, tool calling, and multi-turn work. The default model is
// gpt-5.4-nano, the cheapest current reasoning model ($0.20/$1.25 per 1M tokens)
// (override with LLM_MODEL; callers may override per call with `model`).
// `effort` maps to reasoning.effort; omitting it leaves the model default of
// medium. Use low for latency-sensitive conversational calls and medium for
// judgement-heavy ones.
// When `schema` is supplied we use Structured Outputs (text.format json_schema,
// strict) so the output is guaranteed to match the schema. Tests inject a fake
// LlmClient, so no live calls happen in tests.

export interface JsonSchemaSpec {
  name: string;
  schema: Record<string, unknown>;
}

// Mirrors the reasoning efforts the installed SDK accepts. GPT-5.6 also accepts
// "max", which this SDK version does not type yet.
export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface LlmArgs {
  system: string;
  user: string;
  schema?: JsonSchemaSpec;
  model?: string;
  effort?: ReasoningEffort;
}

export interface LlmClient {
  complete(args: LlmArgs): Promise<string>;
}

export const LLM_MODEL = process.env.LLM_MODEL ?? "gpt-5.4-nano";

let client: OpenAI | null = null;
async function openai(): Promise<OpenAI> {
  if (!client) client = new OpenAI({ apiKey: await secret("OPENAI_API_KEY") });
  return client;
}

export function defaultLlm(): LlmClient {
  return {
    async complete({ system, user, schema, model, effort }) {
      const res = await (await openai()).responses.create({
        model: model ?? (await secret("LLM_MODEL")) ?? LLM_MODEL,
        instructions: system,
        input: [{ role: "user", content: user }],
        ...(effort ? { reasoning: { effort } } : {}),
        ...(schema
          ? {
              text: {
                format: {
                  type: "json_schema" as const,
                  name: schema.name,
                  strict: true,
                  schema: schema.schema,
                },
              },
            }
          : {}),
      });
      for (const item of res.output ?? []) {
        if (item.type !== "message") continue;
        for (const part of item.content ?? []) {
          if (part.type === "refusal") throw new Error(`model refused: ${part.refusal}`);
        }
      }
      return res.output_text ?? "";
    },
  };
}
