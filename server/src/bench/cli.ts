// Brian-bench CLI: npm run bench -- <fetch|ingest|queries|eval|report|reset>
// Measures find_skill retrieval accuracy against a large corpus of skills
// drafted from real GitLab-handbook pages, in an isolated `bench` schema.
import { loadServerEnv } from "../env.js";
loadServerEnv();

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type pg from "pg";

const { makePool } = await import("../db/pool.js");
const { runMigrations } = await import("../db/migrate.js");
const { benchUrl, selectPages } = await import("./lib.js");
const { createSkill, setStatus, findSkillsWithDistance } = await import("../skills/repo.js");
const { parseNewSkill } = await import("../skills/validation.js");
const { defaultLlm } = await import("../llm/complete.js");
const { SKILL_JSON_SCHEMA } = await import("../llm/schemas.js");

const BENCH_DIR = process.env.BENCH_DIR ?? path.join(os.tmpdir(), "brian-bench");
const REPO_DIR = path.join(BENCH_DIR, "handbook");
const MANIFEST = path.join(BENCH_DIR, "bench-manifest.json");
const RESULTS = path.join(BENCH_DIR, "bench-results.json");
const CORPUS_SIZE = Number(process.env.BENCH_CORPUS ?? 120);
const HANDBOOK_GIT = "https://gitlab.com/gitlab-com/content-sites/handbook.git";

function testUrl(): string {
  const u = process.env.TEST_DATABASE_URL;
  if (!u) throw new Error("TEST_DATABASE_URL not set");
  return u;
}

async function setup(): Promise<pg.Pool> {
  const pool = makePool(benchUrl(testUrl()));
  await pool.query("create schema if not exists bench");
  await runMigrations(pool);
  await pool.query(
    `create table if not exists bench_meta (
       page text primary key, title text, skill_id uuid, query text)`
  );
  return pool;
}

function walkMd(dir: string, out: { path: string; bytes: number }[] = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkMd(p, out);
    else if (e.name.endsWith(".md") && e.name !== "_index.md")
      out.push({ path: p, bytes: fs.statSync(p).size });
  }
  return out;
}

function pageText(file: string): { title: string; text: string } {
  let raw = fs.readFileSync(file, "utf8");
  let title = path.basename(file, ".md").replace(/[-_]/g, " ");
  if (raw.startsWith("---")) {
    const end = raw.indexOf("\n---", 3);
    if (end !== -1) {
      const fm = raw.slice(0, end);
      const m = fm.match(/^title:\s*["']?(.+?)["']?\s*$/m);
      if (m) title = m[1];
      raw = raw.slice(end + 4);
    }
  }
  return { title, text: raw.trim().slice(0, 8000) };
}

function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("model returned no JSON");
  return JSON.parse(text.slice(start, end + 1));
}

// Small concurrency pool so 120 LLM calls don't take half an hour.
async function mapPool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function cmdFetch() {
  fs.mkdirSync(BENCH_DIR, { recursive: true });
  if (!fs.existsSync(path.join(REPO_DIR, ".git"))) {
    console.log("cloning handbook (shallow, sparse)...");
    execFileSync("git", ["clone", "--depth", "1", "--filter=blob:none", "--sparse", HANDBOOK_GIT, REPO_DIR], { stdio: "inherit" });
    execFileSync("git", ["-C", REPO_DIR, "sparse-checkout", "set", "content/handbook"], { stdio: "inherit" });
  } else {
    console.log("handbook clone already present");
  }
  const root = path.join(REPO_DIR, "content", "handbook");
  const files = walkMd(root);
  const picks = selectPages(
    files.map((f: { path: string; bytes: number }) => ({ path: path.relative(REPO_DIR, f.path), bytes: f.bytes })),
    CORPUS_SIZE
  );
  fs.writeFileSync(MANIFEST, JSON.stringify(picks, null, 2));
  console.log(`manifest: ${picks.length} pages (from ${files.length} candidates) -> ${MANIFEST}`);
}

async function cmdIngest(pool: pg.Pool) {
  const picks: string[] = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  const { rows } = await pool.query("select page from bench_meta");
  const done = new Set(rows.map((r) => r.page));
  const todo = picks.filter((p) => !done.has(p));
  console.log(`ingesting ${todo.length} pages (${done.size} already done)`);
  const llm = defaultLlm();
  let ok = 0, fail = 0;
  await mapPool(todo, 4, async (page) => {
    try {
      const { title, text } = pageText(path.join(REPO_DIR, page));
      const out = await llm.complete({
        system:
          "You convert a company's process documentation into ONE structured skill. " +
          "Fill the procedure, hard_rules, tools, guardrails, and escalation_target from the text. " +
          "Leave fields empty or null when the text does not specify them.",
        user: `Draft a skill from this document titled "${title}":\n\n${text}`,
        schema: { name: "skill", schema: SKILL_JSON_SCHEMA },
      });
      const input = parseNewSkill(extractJson(out));
      const skill = await createSkill(input, pool);
      await setStatus(skill.id, "active", pool);
      await pool.query(
        "insert into bench_meta (page, title, skill_id) values ($1,$2,$3) on conflict (page) do nothing",
        [page, title, skill.id]
      );
      ok++;
      if (ok % 10 === 0) console.log(`  ${ok}/${todo.length} ingested`);
    } catch (e) {
      fail++;
      console.error(`  FAILED ${page}: ${(e as Error).message.slice(0, 120)}`);
    }
  });
  console.log(`ingest done: ${ok} ok, ${fail} failed`);
}

async function cmdQueries(pool: pg.Pool) {
  const { rows } = await pool.query("select page, title from bench_meta where query is null");
  console.log(`generating queries for ${rows.length} pages`);
  const llm = defaultLlm();
  let n = 0;
  await mapPool(rows, 4, async (r: { page: string; title: string }) => {
    try {
      const { text } = pageText(path.join(REPO_DIR, r.page));
      const q = await llm.complete({
        system:
          "You are an employee about to ask an AI assistant for help with a task. " +
          "Given an internal process document, write ONE short, natural task request " +
          "(max 25 words) that this process would handle. Write it the way a busy " +
          "coworker would type it. Do NOT reuse distinctive phrases, headings, or " +
          "jargon from the document. Return only the request text.",
        user: text.slice(0, 4000),
      });
      await pool.query("update bench_meta set query = $2 where page = $1", [r.page, q.trim().replace(/^"|"$/g, "")]);
      n++;
      if (n % 20 === 0) console.log(`  ${n}/${rows.length}`);
    } catch (e) {
      console.error(`  FAILED ${r.page}: ${(e as Error).message.slice(0, 120)}`);
    }
  });
  console.log(`queries done: ${n}`);
}

async function cmdEval(pool: pg.Pool) {
  const { rows } = await pool.query(
    "select page, title, skill_id, query from bench_meta where query is not null and skill_id is not null"
  );
  const { rows: countRow } = await pool.query("select count(*)::int as n from skills where status = 'active'");
  console.log(`evaluating ${rows.length} queries against ${countRow[0].n} active skills`);
  const results: any[] = [];
  let done = 0;
  await mapPool(rows, 4, async (r: any) => {
    const hits = await findSkillsWithDistance(r.query, 3, pool);
    const top1 = hits[0]?.skill.id === r.skill_id;
    const top3 = hits.some((h) => h.skill.id === r.skill_id);
    results.push({
      page: r.page, title: r.title, query: r.query,
      expected: r.skill_id, top1, top3,
      got: hits.map((h) => ({ id: h.skill.id, name: h.skill.name, distance: Number(h.distance.toFixed(4)) })),
    });
    done++;
    if (done % 20 === 0) console.log(`  ${done}/${rows.length}`);
  });
  const summary = {
    corpus: countRow[0].n,
    queries: results.length,
    top1: results.filter((x) => x.top1).length,
    top3: results.filter((x) => x.top3).length,
    ranAt: new Date().toISOString(),
  };
  fs.writeFileSync(RESULTS, JSON.stringify({ summary, results }, null, 2));
  console.log(
    `top-1: ${summary.top1}/${summary.queries} (${((100 * summary.top1) / summary.queries).toFixed(1)}%)  ` +
    `top-3: ${summary.top3}/${summary.queries} (${((100 * summary.top3) / summary.queries).toFixed(1)}%)`
  );
}

async function cmdReport() {
  const { summary, results } = JSON.parse(fs.readFileSync(RESULTS, "utf8"));
  const misses = results.filter((r: any) => !r.top1).slice(0, 10);
  const pct = (n: number) => ((100 * n) / summary.queries).toFixed(1) + "%";
  const lines = [
    `# Brian-bench: retrieval at scale — ${summary.ranAt.slice(0, 10)}`,
    "",
    `**Corpus:** ${summary.corpus} active skills drafted from real GitLab-handbook pages (CC BY-SA).`,
    `**Labeled queries:** ${summary.queries} (LLM-generated task requests from the raw pages,`,
    `instructed to avoid the documents' distinctive phrasing).`,
    "",
    `| Metric | Result |`,
    `|---|---|`,
    `| Top-1 accuracy (\`find_skill\`) | **${summary.top1}/${summary.queries} (${pct(summary.top1)})** |`,
    `| Top-3 hit rate | ${summary.top3}/${summary.queries} (${pct(summary.top3)}) |`,
    "",
    `## Sample misses (first 10)`,
    "",
    `| Query | Expected | Got (top-1) | dist gap (got vs expected in top-3) |`,
    `|---|---|---|---|`,
    ...misses.map((m: any) => {
      const exp = m.got.find((g: any) => g.id === m.expected);
      const gap = exp ? (exp.distance - m.got[0].distance).toFixed(4) : "not in top-3";
      return `| ${m.query.slice(0, 70).replace(/\|/g, "/")} | ${m.title.slice(0, 40)} | ${m.got[0]?.name.slice(0, 40) ?? "-"} | ${gap} |`;
    }),
    "",
    `## Method & caveats`,
    "",
    `- Skills drafted by \`gpt-5.4-mini\` via the production \`draft-from-text\` pipeline, then activated in an isolated \`bench\` schema; retrieval is the production \`find_skill\` pgvector cosine top-1 over \`text-embedding-3-small\`.`,
    `- Queries are synthetic (LLM) but generated from the raw source pages with anti-copy instructions — the standard synthetic-query eval caveat applies; a hand-written query set is the next hardening step.`,
    `- Handbook pages sometimes overlap topically; some "misses" are near-duplicates where multiple skills are defensible answers. See the results JSON for full per-query data.`,
  ];
  const outDir = path.resolve(import.meta.dirname, "../../../docs/bench");
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `${summary.ranAt.slice(0, 10)}-retrieval.md`);
  fs.writeFileSync(out, lines.join("\n") + "\n");
  console.log(`report -> ${out}`);
}

const cmd = process.argv[2];
if (cmd === "fetch") {
  await cmdFetch();
} else if (cmd === "reset") {
  const pool = makePool(benchUrl(testUrl()));
  await pool.query("drop schema if exists bench cascade");
  await pool.end();
  console.log("bench schema dropped");
} else if (cmd === "ingest" || cmd === "queries" || cmd === "eval") {
  const pool = await setup();
  if (cmd === "ingest") await cmdIngest(pool);
  if (cmd === "queries") await cmdQueries(pool);
  if (cmd === "eval") await cmdEval(pool);
  await pool.end();
} else if (cmd === "report") {
  await cmdReport();
} else {
  console.error("usage: npm run bench -- [fetch | ingest | queries | eval | report | reset]");
  process.exit(1);
}
