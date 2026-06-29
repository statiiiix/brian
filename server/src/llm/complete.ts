import OpenAI from "openai";

// Single seam for all generative LLM calls (skill drafting + capture).
// Provider is OpenAI; model defaults to gpt-5.4-mini (override with LLM_MODEL).
// When `schema` is supplied we use Structured Outputs (response_format json_schema,
// strict) so the model output is guaranteed to match the schema — OpenAI's
// recommended approach for the GPT-5 reasoning family. Tests inject a fake
// LlmClient, so no live calls happen in tests.

export interface JsonSchemaSpec {
  name: string;
  schema: Record<string, unknown>;
}

export interface LlmClient {
  complete(args: { system: string; user: string; schema?: JsonSchemaSpec }): Promise<string>;
}

export const LLM_MODEL = process.env.LLM_MODEL ?? "gpt-5.4-mini";

let client: OpenAI | null = null;
function openai(): OpenAI {
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

export function defaultLlm(): LlmClient {
  return {
    async complete({ system, user, schema }) {
      const res = await openai().chat.completions.create({
        model: LLM_MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        ...(schema
          ? {
              response_format: {
                type: "json_schema",
                json_schema: { name: schema.name, strict: true, schema: schema.schema },
              },
            }
          : {}),
      });
      const msg = res.choices[0]?.message;
      if (msg?.refusal) throw new Error(`model refused: ${msg.refusal}`);
      return msg?.content ?? "";
    },
  };
}
