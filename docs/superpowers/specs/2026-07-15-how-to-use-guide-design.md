# Brian How-to-Use Guide Design

## Purpose

Create a root-level `HowtoUse.md` that teaches both everyday users and Brian administrators how to install, connect, use, diagnose, and disconnect Brian. The guide must work as a first-run tutorial and as a precise operational reference.

## Audience

- Everyday users connecting Brian to Codex, Cursor, Claude Code, or Claude Desktop.
- Brian administrators who need to understand connection approvals, permissions, revocation, security behavior, and operational checks.
- Developers using the CLI from the repository before the npm package is published.
- Companies using standards-compatible remote MCP agents that Brian's CLI does not recognize by name.

## Documentation approach

Use a progressive guide. Start with the shortest safe path to a working connection, then explain the CLI, client-specific behavior, normal usage, administration, security, and troubleshooting in increasing depth. Avoid duplicating separate user and administrator manuals.

Clearly distinguish:

- current local-source commands that work before npm publication;
- future `npx @brianthebrain/cli ...` and globally installed `brian ...` commands;
- configuration from authentication: the CLI writes the hosted MCP URL, while the AI client owns OAuth tokens and launches browser login;
- public user actions from administrator-only production operations.
- known-client automation from universal protocol access: the CLI automates known configuration formats, while any other compatible agent connects manually to Brian's canonical MCP URL and follows MCP/OAuth discovery.

## Required sections

1. What Brian is and how the AI-agent connection works.
2. Requirements and current publication status.
3. Quick start for local-source use and future npm use.
4. Optional global installation and the `brian` executable.
5. Full CLI command reference for `signup`, `connect`, `status`, `doctor`, and `disconnect`.
6. Every public option: `--only`, `--dry-run`, `--yes`/`-y`, `--no-login`, `--json`, `--help`/`-h`, and `--version`.
7. Interactive prompts, non-interactive behavior, backups, idempotency, malformed-config protection, and legacy-token warnings.
8. Client-specific connection and authentication guidance for Codex, Cursor, Claude Code, and Claude Desktop.
9. Manual connection guidance and a compatibility checklist for unknown or custom enterprise agents that implement remote MCP.
10. Browser login, company selection, permission review, approval, token refresh, and revocation lifecycle.
11. Examples of using Brian from an AI conversation after connection.
12. Administrator guidance for availability flags, monitoring, revocation, incident handling, and public signup boundaries.
13. Security and credential-handling guarantees.
14. Troubleshooting and recovery paths.
15. Common workflows, command examples, and a compact quick-reference table.
16. Current limitations and launch status without claiming unverified compatibility or publication.

## Accuracy requirements

- Derive commands and options from the actual CLI help and source.
- Use `https://api.brianthebrain.app/mcp` as the only public MCP resource.
- Do not imply that the npm package is published until registry publication is verified.
- Do not claim a client is production-compatible without a dated result in the compatibility matrix.
- Describe universal access as support for any standards-compatible remote MCP client, not literally every AI product; agents without MCP or a compatible OAuth flow require an adapter or client upgrade.
- Never instruct users to paste static bearer tokens into client configuration.
- Explain that browser OAuth credentials are owned by the AI client, not stored by the Brian CLI.
- Link to existing repository runbooks instead of copying large operational procedures.

## Verification

Before completion:

- compare every documented CLI command and option with `brian --help` and command parsing source;
- verify local-source examples against the CLI entry point;
- check every linked repository file exists;
- scan for placeholders, contradictions, accidental secret examples, and stale publication claims;
- run the CLI test suite and Markdown-oriented link/path checks available in the repository;
- review the final diff for clarity and consistency with this design.
