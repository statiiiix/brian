import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import Fastify from "fastify";

const script = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../scripts/hooks/brian-hook.mjs"
);

function runHook(input: unknown, env: Record<string, string>) {
  return new Promise<{ code: number | string; stdout: string }>((resolve, reject) => {
    const child = execFile(
      process.execPath, [script],
      { env: { ...process.env, BRIAN_ENV_FILE: "/dev/null", ...env }, timeout: 10000 },
      (err, stdout) => {
        if (err && err.code === undefined) return reject(err);
        resolve({ code: (err?.code as number | string | undefined) ?? 0, stdout });
      }
    );
    child.stdin!.end(JSON.stringify(input));
  });
}

describe("brian-hook", () => {
  const stub = Fastify();
  let base = "";
  const seen: { auth?: string; query?: string } = {};
  stub.post("/api/agent/briefing", async (req) => {
    seen.auth = req.headers.authorization;
    seen.query = (req.body as { query: string }).query;
    return {
      skill: { id: "s1", name: "Refund handling", procedure: "check order", hard_rules: ["max $200"] },
      context: { id: "c1", content: "Retention over margin" },
    };
  });
  beforeAll(async () => { base = await stub.listen({ port: 0, host: "127.0.0.1" }); });
  afterAll(async () => { await stub.close(); });

  it("SessionStart emits the agent contract", async () => {
    const { code, stdout } = await runHook(
      { hook_event_name: "SessionStart", source: "startup" },
      { BRIAN_URL: "http://127.0.0.1:9" }
    );
    expect(code).toBe(0);
    const out = JSON.parse(stdout);
    expect(out.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(out.hookSpecificOutput.additionalContext).toContain("find_skill");
    expect(out.hookSpecificOutput.additionalContext).toContain("log_execution");
  });

  it("UserPromptSubmit injects briefing from the API with auth", async () => {
    const { code, stdout } = await runHook(
      { hook_event_name: "UserPromptSubmit", prompt: "refund order 123" },
      { BRIAN_URL: base, BRIAN_API_TOKEN: "tok123" }
    );
    expect(code).toBe(0);
    expect(seen.auth).toBe("Bearer tok123");
    expect(seen.query).toBe("refund order 123");
    const out = JSON.parse(stdout);
    expect(out.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
    expect(out.hookSpecificOutput.additionalContext).toContain("Refund handling");
    expect(out.hookSpecificOutput.additionalContext).toContain("Retention over margin");
  });

  it("is silent when the server is unreachable", async () => {
    const { code, stdout } = await runHook(
      { hook_event_name: "UserPromptSubmit", prompt: "refund order 123" },
      { BRIAN_URL: "http://127.0.0.1:1" }
    );
    expect(code).toBe(0);
    expect(stdout.trim()).toBe("");
  });

  it("is silent on empty prompts", async () => {
    const { code, stdout } = await runHook(
      { hook_event_name: "UserPromptSubmit", prompt: "  " },
      { BRIAN_URL: "http://127.0.0.1:1" }
    );
    expect(code).toBe(0);
    expect(stdout.trim()).toBe("");
  });
});
