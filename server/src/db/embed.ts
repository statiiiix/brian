import OpenAI from "openai";

let client: OpenAI | null = null;
function openai(): OpenAI {
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

export const EMBED_DIM = 1536;

export async function embed(text: string): Promise<number[]> {
  const res = await openai().embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  return res.data[0].embedding;
}
