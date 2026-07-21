import type { Connector, RawThread } from "../../types.js";
import {
  accessToken, apiJson, MAX_ITEMS_PER_SYNC, nextSinceCursor, selectedString,
  selectedStrings, sinceIso, type FetchLike,
} from "./common.js";

// --- Linear (GraphQL) ---

export interface LinearIssue {
  identifier: string;
  title?: string;
  description?: string;
  url?: string;
  updatedAt?: string;
  creator?: { name?: string };
  comments?: { nodes?: { body?: string; createdAt?: string; user?: { name?: string } }[] };
}

export function linearIssueToRaw(issue: LinearIssue): RawThread {
  const creator = issue.creator?.name ?? "linear-creator";
  const participants = new Map<string, boolean>([[creator, false]]);
  const messages = [{
    from: creator,
    ts: issue.updatedAt ?? "",
    text: `${issue.title ?? issue.identifier}\n${issue.description ?? ""}`.trim(),
  }];
  for (const comment of issue.comments?.nodes ?? []) {
    const author = comment.user?.name ?? "linear-commenter";
    participants.set(author, false);
    messages.push({ from: author, ts: comment.createdAt ?? "", text: comment.body ?? "" });
  }
  return {
    thread_id: `linear:${issue.identifier}`,
    permalink: issue.url ?? "",
    participants: [...participants.keys()].map((id) => ({ id, is_company_member: true, is_bot: false })),
    messages: messages.filter((m) => m.text.trim()),
  };
}

const LINEAR_QUERY = `query RecentIssues($since: DateTimeOrDuration!, $first: Int!) {
  issues(first: $first, orderBy: updatedAt, filter: { updatedAt: { gt: $since } }) {
    nodes {
      identifier title description url updatedAt
      creator { name }
      comments(first: 20) { nodes { body createdAt user { name } } }
    }
  }
}`;

export function linearConnector(creds: Record<string, unknown>, fetchFn: FetchLike = fetch): Connector {
  return {
    type: "linear",
    async fetch(_creds, cursor) {
      const checkpoint = new Date().toISOString();
      const token = accessToken(creds);
      const res = await apiJson(fetchFn, "https://api.linear.app/graphql", {
        token,
        method: "POST",
        body: { query: LINEAR_QUERY, variables: { since: sinceIso(cursor), first: MAX_ITEMS_PER_SYNC } },
      });
      if (res.errors?.length) throw new Error(`Linear query failed: ${res.errors[0]?.message}`);
      const items = ((res.data?.issues?.nodes ?? []) as LinearIssue[]).map(linearIssueToRaw);
      const complete = items.length < MAX_ITEMS_PER_SYNC;
      return { items, nextCursor: complete ? nextSinceCursor(checkpoint) : { updated_since: sinceIso(cursor) } };
    },
  };
}

// --- GitHub ---

export interface GitHubIssue {
  number: number;
  title?: string;
  body?: string;
  html_url?: string;
  updated_at?: string;
  comments?: number;
  comments_url?: string;
  user?: { login?: string; type?: string };
  pull_request?: unknown;
}

export interface GitHubComment {
  body?: string;
  created_at?: string;
  user?: { login?: string; type?: string };
}

export function githubIssueToRaw(repo: string, issue: GitHubIssue, comments: GitHubComment[]): RawThread {
  const participants = new Map<string, boolean>();
  const author = issue.user?.login ?? "github-author";
  participants.set(author, issue.user?.type === "Bot");
  const messages = [{
    from: author,
    ts: issue.updated_at ?? "",
    text: `${issue.title ?? `#${issue.number}`}\n${issue.body ?? ""}`.trim(),
  }];
  for (const comment of comments) {
    const login = comment.user?.login ?? "github-commenter";
    participants.set(login, (participants.get(login) ?? false) || comment.user?.type === "Bot");
    messages.push({ from: login, ts: comment.created_at ?? "", text: comment.body ?? "" });
  }
  return {
    thread_id: `github:${repo}#${issue.number}`,
    permalink: issue.html_url ?? "",
    participants: [...participants.entries()].map(([id, is_bot]) => ({ id, is_bot, is_company_member: true })),
    messages: messages.filter((m) => m.text.trim()),
  };
}

export function githubConnector(creds: Record<string, unknown>, fetchFn: FetchLike = fetch): Connector {
  const headers = { "x-github-api-version": "2022-11-28" };
  return {
    type: "github",
    async fetch(_creds, cursor) {
      const checkpoint = new Date().toISOString();
      const token = accessToken(creds);
      const since = sinceIso(cursor);
      const repos = selectedStrings(creds, "selected_repositories");
      const items: RawThread[] = [];
      let complete = true;
      for (const repo of repos) {
        if (items.length >= MAX_ITEMS_PER_SYNC) { complete = false; break; }
        const issues = await apiJson(
          fetchFn,
          `https://api.github.com/repos/${repo}/issues?state=all&sort=updated&direction=desc&per_page=10&since=${encodeURIComponent(since)}`,
          { token, headers },
        );
        if ((issues ?? []).length >= 10) complete = false;
        for (const issue of (issues ?? []) as GitHubIssue[]) {
          if (items.length >= MAX_ITEMS_PER_SYNC) { complete = false; break; }
          const comments = issue.comments && issue.comments_url
            ? await apiJson(fetchFn, `${issue.comments_url}?per_page=30`, { token, headers })
            : [];
          items.push(githubIssueToRaw(repo, issue, (comments ?? []) as GitHubComment[]));
        }
      }
      return { items, nextCursor: complete ? nextSinceCursor(checkpoint) : { updated_since: sinceIso(cursor) } };
    },
  };
}

// --- Asana ---

export interface AsanaTask {
  gid: string;
  name?: string;
  notes?: string;
  modified_at?: string;
  permalink_url?: string;
  assignee?: { name?: string };
}

export interface AsanaStory {
  type?: string;
  text?: string;
  created_at?: string;
  created_by?: { name?: string };
}

export function asanaTaskToRaw(task: AsanaTask, stories: AsanaStory[]): RawThread {
  const owner = task.assignee?.name ?? "asana-owner";
  const participants = new Map<string, boolean>([[owner, false]]);
  const messages = [{
    from: owner,
    ts: task.modified_at ?? "",
    text: `${task.name ?? task.gid}\n${task.notes ?? ""}`.trim(),
  }];
  for (const story of stories) {
    if (story.type !== "comment" || !story.text) continue;
    const author = story.created_by?.name ?? "asana-commenter";
    participants.set(author, false);
    messages.push({ from: author, ts: story.created_at ?? "", text: story.text });
  }
  return {
    thread_id: `asana:${task.gid}`,
    permalink: task.permalink_url ?? "",
    participants: [...participants.keys()].map((id) => ({ id, is_company_member: true, is_bot: false })),
    messages: messages.filter((m) => m.text.trim()),
  };
}

export function asanaConnector(creds: Record<string, unknown>, fetchFn: FetchLike = fetch): Connector {
  const base = "https://app.asana.com/api/1.0";
  return {
    type: "asana",
    async fetch(_creds, cursor) {
      const checkpoint = new Date().toISOString();
      const token = accessToken(creds);
      const since = sinceIso(cursor);
      const projects = selectedStrings(creds, "selected_project_ids");
      const items: RawThread[] = [];
      let complete = true;
      for (const project of projects) {
        if (items.length >= MAX_ITEMS_PER_SYNC) { complete = false; break; }
        const tasks = await apiJson(
          fetchFn,
          `${base}/tasks?project=${project}&modified_since=${encodeURIComponent(since)}`
            + `&limit=10&opt_fields=name,notes,modified_at,permalink_url,assignee.name`,
          { token },
        );
        if ((tasks.data ?? []).length >= 10) complete = false;
        for (const task of (tasks.data ?? []) as AsanaTask[]) {
          if (items.length >= MAX_ITEMS_PER_SYNC) { complete = false; break; }
          const stories = await apiJson(
            fetchFn,
            `${base}/tasks/${task.gid}/stories?opt_fields=type,text,created_at,created_by.name`,
            { token },
          );
          items.push(asanaTaskToRaw(task, (stories.data ?? []) as AsanaStory[]));
        }
      }
      return { items, nextCursor: complete ? nextSinceCursor(checkpoint) : { updated_since: sinceIso(cursor) } };
    },
  };
}

// --- ClickUp ---

export interface ClickUpTask {
  id: string;
  name?: string;
  text_content?: string;
  url?: string;
  date_updated?: string;
  creator?: { username?: string };
}

export interface ClickUpComment {
  comment_text?: string;
  date?: string;
  user?: { username?: string };
}

export function clickupTaskToRaw(task: ClickUpTask, comments: ClickUpComment[]): RawThread {
  const creator = task.creator?.username ?? "clickup-creator";
  const participants = new Map<string, boolean>([[creator, false]]);
  const updatedIso = task.date_updated ? new Date(Number(task.date_updated)).toISOString() : "";
  const messages = [{
    from: creator,
    ts: updatedIso,
    text: `${task.name ?? task.id}\n${task.text_content ?? ""}`.trim(),
  }];
  for (const comment of comments) {
    if (!comment.comment_text) continue;
    const author = comment.user?.username ?? "clickup-commenter";
    participants.set(author, false);
    messages.push({
      from: author,
      ts: comment.date ? new Date(Number(comment.date)).toISOString() : "",
      text: comment.comment_text,
    });
  }
  return {
    thread_id: `clickup:${task.id}`,
    permalink: task.url ?? "",
    participants: [...participants.keys()].map((id) => ({ id, is_company_member: true, is_bot: false })),
    messages: messages.filter((m) => m.text.trim()),
  };
}

export function clickupConnector(creds: Record<string, unknown>, fetchFn: FetchLike = fetch): Connector {
  const base = "https://api.clickup.com/api/v2";
  return {
    type: "clickup",
    async fetch(_creds, cursor) {
      const checkpoint = new Date().toISOString();
      const token = accessToken(creds);
      const since = Date.parse(sinceIso(cursor));
      const team = selectedString(creds, "selected_team_id");
      const tasks = await apiJson(
        fetchFn,
        `${base}/team/${team}/task?order_by=updated&reverse=true&date_updated_gt=${since}&include_closed=true`,
        { headers: { authorization: token } },
      );
      const items: RawThread[] = [];
      const complete = (tasks.tasks ?? []).length < 100 && tasks.last_page !== false;
      for (const task of ((tasks.tasks ?? []) as ClickUpTask[]).slice(0, MAX_ITEMS_PER_SYNC)) {
        const comments = await apiJson(fetchFn, `${base}/task/${task.id}/comment`, { headers: { authorization: token } });
        items.push(clickupTaskToRaw(task, (comments.comments ?? []) as ClickUpComment[]));
      }
      return { items, nextCursor: complete ? nextSinceCursor(checkpoint) : { updated_since: sinceIso(cursor) } };
    },
  };
}
