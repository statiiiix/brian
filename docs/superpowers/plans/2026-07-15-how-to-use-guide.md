# Brian How-to-Use Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a complete `HowtoUse.md` for everyday users, administrators, and companies connecting known or custom standards-compatible MCP agents to Brian.

**Architecture:** One progressive root-level guide starts with a safe quick start and expands into command reference, known-client instructions, universal MCP connection requirements, normal usage, administration, security, and troubleshooting. The checked-in CLI help and source remain authoritative; existing specialized runbooks are linked instead of duplicated.

**Tech Stack:** Markdown, Node.js 22+, Brian CLI, remote Streamable HTTP MCP, OAuth 2.1 with PKCE and Dynamic Client Registration.

## Global Constraints

- The only public MCP resource is `https://api.brianthebrain.app/mcp`.
- The npm package is `@brianthebrain/cli`, and its executable is `brian`.
- The npm package must be described as unpublished until registry publication is verified.
- Universal access means any standards-compatible remote MCP client, not every AI product regardless of protocol support.
- The CLI never accepts or writes a static bearer token and never stores OAuth access or refresh tokens.
- Client compatibility claims must match the dated evidence in `docs/mcp-client-compatibility.md`.
- Local-source instructions must work before npm publication; npm and global-install instructions must be clearly labeled as post-publication paths.

---

### Task 1: Write the progressive Brian usage guide

**Files:**
- Create: `HowtoUse.md`
- Reference: `packages/cli/src/args.mjs`
- Reference: `packages/cli/src/commands/clients.mjs`
- Reference: `packages/cli/src/commands/doctor.mjs`
- Reference: `packages/cli/src/commands/signup.mjs`
- Reference: `packages/cli/src/login/native.mjs`
- Reference: `packages/cli/src/platforms/*.mjs`
- Reference: `docs/cli.md`
- Reference: `docs/mcp-client-compatibility.md`
- Reference: `docs/security/token-handling.md`

**Interfaces:**
- Consumes: the public CLI surface `signup | connect | status | doctor | disconnect`, options `--only`, `--dry-run`, `--yes`/`-y`, `--no-login`, `--json`, `--help`/`-h`, and `--version`.
- Produces: a self-contained guide whose command examples use either `node packages/cli/src/index.mjs`, `npx @brianthebrain/cli`, or the globally installed `brian` executable with an explicit availability label.

- [x] **Step 1: Create the guide skeleton and status banner**

Create `HowtoUse.md` with these exact top-level sections in progressive order:

```markdown
# How to use Brian

> Publication status: ...

## What Brian is
## How the connection works
## Requirements
## Quick start
## Running the CLI
## Complete CLI command reference
## Supported and custom AI agents
## Browser login and consent
## Using Brian in an AI conversation
## Connection lifecycle and revocation
## Administrator guide
## Security model
## Troubleshooting
## Common workflows
## Current limitations
## Quick-reference table
## Further documentation
```

The publication banner must say the package is implemented but not yet verified as published. It must show the current local-source invocation and label npm/global commands as available only after publication.

- [x] **Step 2: Document installation and all CLI behavior**

Include executable examples for all three invocation forms:

```bash
node packages/cli/src/index.mjs connect
npx @brianthebrain/cli connect
npm install --global @brianthebrain/cli
brian connect
```

Document every public command, every public option, interactive confirmation defaults, JSON mutation requirements, stable exit codes, detected-client behavior, backups, atomic preflight, idempotency, and the difference between local configuration removal and server-side revocation.

- [x] **Step 3: Document known and unknown AI-agent connection paths**

For known clients, include the exact automated or manual follow-up flow:

```bash
codex mcp login brian
claude mcp login brian
```

Explain that Cursor and Claude Desktop use their connection UI after restart. Add a custom-agent checklist requiring remote Streamable HTTP MCP, the canonical URL, RFC 9728 protected-resource discovery, OAuth authorization-code + PKCE S256, DCR or pre-registered client metadata, refresh support, and bearer challenge handling. State that unsupported products need an MCP/OAuth adapter or upgrade.

- [x] **Step 4: Document usage, administration, and security**

Show conversation examples for finding knowledge, requesting a briefing, and using permitted actions without inventing tool guarantees. Explain company selection, required versus optional permissions, viewer restrictions, access-token refresh, immediate Brian grant revocation, OAuth-provider revocation, DCR/approval kill switches, monitoring, public-signup boundaries, and links to the existing incident runbooks.

- [x] **Step 5: Add troubleshooting, workflows, and quick reference**

Cover no detected clients, npm 404 before publication, paused approvals, missing native login commands, malformed or read-only config, legacy raw endpoints/static credentials, browser launch failure, failed `doctor`, restart requirements, and the distinction between `disconnect` and revocation. Finish with copyable workflows and a compact command table.

### Task 2: Verify the guide against the product

**Files:**
- Verify: `HowtoUse.md`
- Verify: `docs/superpowers/specs/2026-07-15-how-to-use-guide-design.md`
- Test: `packages/cli/test/*.test.mjs`

**Interfaces:**
- Consumes: the completed `HowtoUse.md` and the actual CLI runtime.
- Produces: a placeholder-free, internally consistent guide with valid repository-relative links and tested commands.

- [x] **Step 1: Compare the guide with CLI help**

Run:

```bash
node packages/cli/src/index.mjs --help
node packages/cli/src/index.mjs --version
```

Expected: the guide lists exactly the same commands, client names, and public options, and the version is `0.1.0`.

- [x] **Step 2: Exercise safe local examples**

Run:

```bash
node packages/cli/src/index.mjs signup --dry-run --json
node packages/cli/src/index.mjs connect --dry-run --only codex --json
node packages/cli/src/index.mjs status --only codex --json
```

Expected: JSON output contains no credential value; dry-run commands make no changes; the canonical URL is `https://api.brianthebrain.app/mcp`.

- [x] **Step 3: Run package verification**

Run:

```bash
cd packages/cli
npm test
npm run check
npm pack --dry-run
```

Expected: all tests pass, syntax check passes, and the package manifest includes the `brian` executable and documentation files without generated credential material.

- [x] **Step 4: Scan documentation quality and links**

Run repository searches for `TBD`, `TODO`, placeholder language, static bearer examples, inaccurate publication claims, and every relative Markdown target. Verify each linked path exists and run `git diff --check`.

Expected: no placeholders, no command that asks users to paste a token, no broken repository link, and no whitespace errors.

- [x] **Step 5: Commit the completed guide**

```bash
git add HowtoUse.md docs/superpowers/specs/2026-07-15-how-to-use-guide-design.md docs/superpowers/plans/2026-07-15-how-to-use-guide.md
git commit -m "docs: add complete Brian usage guide"
```

Expected: one documentation commit containing the finished guide, the universal-MCP design clarification, and this implementation plan.
