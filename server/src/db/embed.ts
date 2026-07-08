import OpenAI from "openai";
import { secret } from "../config/secrets.js";

let client: OpenAI | null = null;
async function openai(): Promise<OpenAI> {
  if (!client) client = new OpenAI({ apiKey: await secret("OPENAI_API_KEY") });
  return client;
}

export const EMBED_DIM = 1536;

export async function embed(text: string): Promise<number[]> {
  const res = await (await openai()).embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  return res.data[0].embedding;
}
