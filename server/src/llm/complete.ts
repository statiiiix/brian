import OpenAI from "openai";

// Single seam for all generative LLM calls (skill drafting + capture).
// Provider is OpenAI; model defaults to gpt-5.4-mini (override with LLM_MODEL).
// Tests inject a fake LlmClient, so no live calls happen in tests.
export interface LlmClient {
  complete(args: { system: string; user: string; maxTokens?: number }): Promise<string>;
}

export const LLM_MODEL = process.env.LLM_MODEL ?? "gpt-5.4-mini";

let client: OpenAI | null = null;
function openai(): OpenAI {
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

export function defaultLlm(): LlmClient {
  return {
    async complete({ system, user, maxTokens }) {
      const res = await openai().chat.completions.create({
        model: LLM_MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        ...(maxTokens ? { max_completion_tokens: maxTokens } : {}),
      });
      return res.choices[0]?.message?.content ?? "";
    },
  };
}
