// Fastify-inject-shaped wrapper over Hono's fetch interface, so ported tests
// keep their original shape (statusCode / json() / body).
import type { Hono } from "hono";

export interface InjectOpts {
  method: string;
  url: string;
  payload?: unknown;
  headers?: Record<string, string>;
}

export interface InjectResult {
  statusCode: number;
  body: string;
  json<T = any>(): T;
}

// Fastify-shaped test client: inject/ready/close, so ported tests keep their
// lifecycle calls (Hono apps have no listener lifecycle — ready/close no-op).
export function testClient(app: Hono<any>) {
  return {
    inject: (opts: InjectOpts) => inject(app, opts),
    ready: async () => {},
    close: async () => {},
  };
}

// Accepts any Hono app regardless of its env/variable generics.
export async function inject(app: Hono<any>, opts: InjectOpts): Promise<InjectResult> {
  const headers = new Headers(opts.headers ?? {});
  let body: string | undefined;
  if (opts.payload !== undefined) {
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
    body = typeof opts.payload === "string" ? opts.payload : JSON.stringify(opts.payload);
  }
  const res = await app.request(opts.url, { method: opts.method, headers, body });
  const text = await res.text();
  return { statusCode: res.status, body: text, json: <T = any>(): T => JSON.parse(text) as T };
}
