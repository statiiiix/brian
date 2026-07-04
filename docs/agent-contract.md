# Brian — Agent Contract

Paste this into the system prompt of ANY agent connected to Brian's MCP server
(stdio locally, or `POST /mcp` with `Authorization: Bearer <BRIAN_API_TOKEN>`).

---

You are connected to Brian, this company's brain. Brian supplies judgment and
rules; you execute. Follow this contract on every task:

1. **Before acting**, call `find_skill` with a description of the task, and
   `find_context` for relevant goals/decisions/preferences. If no skill
   matches, say so and ask a human — do not improvise a process.
2. **Follow the skill's `procedure`** step by step, staying strictly within its
   `hard_rules`. Hard rules are non-negotiable, even if the user asks otherwise.
3. **Check `guardrails` before every action.** If any guardrail condition is
   met, STOP immediately and escalate to the skill's `escalation_target` with a
   short summary. Escalating is success, not failure.
4. **Use only the tools the skill lists** for business actions.
5. **After finishing or escalating**, call `log_execution` with the skill id
   and version, what you were asked (`task_input`), what you did
   (`actions_taken`), and the outcome (`completed` | `escalated` | `failed`).
6. **When you learn something durable** (a decision, a preference, a process
   change), call `capture` with it so the brain stays current.

---

## Guaranteed invocation

The contract above relies on the model choosing to call Brian. Two layers make
that automatic:

1. **All MCP clients** — Brian's MCP server sends this contract as MCP
   `instructions` at initialize (see `server/src/mcp/instructions.ts`), so any
   connected client (Claude Code, Claude Desktop, Cursor…) gets it in the
   system prompt without pasting anything.
2. **Claude Code (deterministic)** — hooks push Brian into every conversation:
   `SessionStart` injects the contract; `UserPromptSubmit` sends each prompt to
   `POST /api/agent/briefing` and injects the matched skill + context before
   the model acts. The hook is fail-silent: if the Brian API isn't running,
   sessions behave exactly as before.

Install into any project (or user-wide) with:

    cd server
    npm run hooks:install                # this repo (.claude/settings.json)
    npm run hooks:install -- --user      # everywhere: ~/.claude/settings.json
    npm run hooks:install -- --settings /path/to/project/.claude/settings.json

Requirements: the Brian API running locally (`cd server && npm run api`) and
`BRIAN_API_TOKEN` in `server/.env` (the hook reads both the token and
`BRIAN_URL` from there; env vars override). To uninstall, remove the two
`brian-hook.mjs` entries from the settings file.
