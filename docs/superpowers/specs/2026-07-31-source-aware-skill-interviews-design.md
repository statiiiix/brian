# Source-aware skill interviews

**Date:** 2026-07-31  
**Status:** Approved

## Goal

Make Brian understand the provider behind every source attached to a skill
interview. Provider-specific guidance must work both when a skill is created
from sources and when sources are added during an ordinary interview.

The implementation covers the full dashboard catalog:

- Notion
- Confluence
- SharePoint
- OneDrive
- Google Drive
- Gmail
- Outlook
- Slack
- Microsoft Teams
- Jira
- Linear
- GitHub
- Asana
- ClickUp
- Zendesk
- Intercom
- HubSpot
- Salesforce
- Gong
- Zoom

## Architecture

Add one typed source-guidance registry in the server interview domain. It is
keyed by the provider IDs already stored on interview sources. Each entry
contains:

- the provider's human-readable name;
- what the provider's data represents;
- instructions for interpreting its structure, chronology, and authority;
- cautions about conclusions that require expert confirmation.

The interview engine builds source guidance from ready attached sources. It
deduplicates provider IDs and injects only the relevant provider blocks into
both model prompts:

1. The hidden parser uses the blocks while extracting draft fields and
   evidence.
2. The conversational interviewer uses the blocks when summarizing material
   and choosing the next question.

The registry is shared by initial source-grounded interviews and ordinary
interviews with sources added later. The deployable Supabase edge function is
regenerated from the server source.

## Prompt behavior

Every ready source is labeled with its provider name even when it has no URL.
Each material block identifies the provider explicitly so the models never
have to infer where the content came from.

When several providers are attached, each receives a separate rule block.
Brian must reconcile evidence without silently treating sources as equally
authoritative. Provider guidance is contextual, not permission to promote
content to company policy.

Examples of the intended distinctions:

- Slack and Microsoft Teams preserve conversational decisions, alternatives,
  and chronology, but discussion is not automatically approved policy.
- Jira, Linear, Asana, and ClickUp expose workflow state and resolution
  history, but a closed status alone does not prove the resolution is correct
  or reusable.
- HubSpot and Salesforce provide structured pipeline and record context, where
  field semantics, stage changes, and ownership matter.
- Notion, Confluence, SharePoint, OneDrive, Google Drive, and GitHub often
  contain durable documents, but freshness, scope, and document authority must
  still be checked.
- Gmail and Outlook preserve approvals and exceptions in thread context;
  quoted text, forwards, and chronology must not be flattened.
- Zendesk and Intercom provide customer cases and resolutions; one-off
  handling must be distinguished from repeatable policy.
- Gong and Zoom provide spoken explanations and decisions; transcripts may be
  imperfect and tentative statements require confirmation.

Uploaded files receive generic file guidance. Web research remains explicitly
external guidance and is never treated as company policy.

## Source lifecycle

Only attached sources with ready, non-empty material affect prompts.
Connected-but-unselected, failed, or empty sources are excluded.

Adding a source during an active interview affects the next hidden-parser and
conversational-interviewer turn because both build their prompt from the
current interview source list.

If a future provider is attached before explicit guidance is added, a
conservative generic company-source block is used. This prevents an interview
failure while keeping the missing provider mapping observable in tests.

## Testing

Automated tests will prove:

- every source in the dashboard catalog has explicit provider guidance;
- provider names and only the relevant rule blocks reach both model prompts;
- several providers remain separately labeled and are deduplicated;
- sources added during an interview affect the next turn;
- failed, empty, and unready sources are excluded;
- unknown providers receive the generic fallback;
- existing Notion source-grounded behavior remains unchanged;
- the generated Supabase edge bundle contains the source-guidance behavior.

Implementation follows test-driven development: each new behavior is captured
by a failing test before production code is changed.

## Non-goals

- Changing connector OAuth, selection, or synchronization behavior.
- Connecting currently unconnected providers.
- Treating provider content as approved policy without expert confirmation.
- Sending the entire source catalog's rules on every interview turn.
