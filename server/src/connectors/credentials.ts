import { Buffer } from "node:buffer";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { secret } from "../config/secrets.js";

const ALGORITHM = "aes-256-gcm";
const MARKER = "aes-256-gcm-v1";

interface EncryptedCredentials {
  __format: typeof MARKER;
  iv: string;
  tag: string;
  data: string;
}

function keyFromEnv(env: NodeJS.ProcessEnv = process.env): Buffer | null {
  const raw = env.CONNECTOR_ENCRYPTION_KEY;
  if (!raw) return null;
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, "hex");
  return createHash("sha256").update(raw).digest();
}

export function encryptCredentials(value: unknown, env: NodeJS.ProcessEnv = process.env): unknown {
  const key = keyFromEnv(env);
  if (!key) throw new Error("CONNECTOR_ENCRYPTION_KEY is required to store connector credentials");
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return {
    __format: MARKER,
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    data: data.toString("base64url"),
  } satisfies EncryptedCredentials;
}

export function decryptCredentials(value: unknown, env: NodeJS.ProcessEnv = process.env): Record<string, unknown> {
  if (!value || typeof value !== "object" || (value as { __format?: string }).__format !== MARKER) {
    return (value ?? {}) as Record<string, unknown>;
  }
  const key = keyFromEnv(env);
  if (!key) throw new Error("CONNECTOR_ENCRYPTION_KEY is required to read connector credentials");
  const encrypted = value as EncryptedCredentials;
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(encrypted.iv, "base64url"));
  decipher.setAuthTag(Buffer.from(encrypted.tag, "base64url"));
  const json = Buffer.concat([
    decipher.update(Buffer.from(encrypted.data, "base64url")),
    decipher.final(),
  ]).toString("utf8");
  return JSON.parse(json) as Record<string, unknown>;
}

async function runtimeEncryptionEnv(): Promise<NodeJS.ProcessEnv> {
  const key = await secret("CONNECTOR_ENCRYPTION_KEY");
  return key ? { CONNECTOR_ENCRYPTION_KEY: key } : {};
}

export async function encryptStoredCredentials(value: unknown): Promise<unknown> {
  return encryptCredentials(value, await runtimeEncryptionEnv());
}

export async function decryptStoredCredentials(value: unknown): Promise<Record<string, unknown>> {
  return decryptCredentials(value, await runtimeEncryptionEnv());
}
