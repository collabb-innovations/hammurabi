import type { Proposal } from "../../schema/lock.js";
import { HammurabiLockError } from "../errors.js";
import {
  listTasks,
  mergeSections,
  renderProposal,
} from "../tasks.js";
import type { AdapterChoice, SourceAdapter, SourceDoc } from "./types.js";

export interface GitHubAdapterOptions {
  token?: () => string | undefined;
  fetch?: typeof fetch;
  apiBase?: string;
}

interface GhIssue {
  title?: string;
  body?: string | null;
  html_url?: string;
}

interface GhComment {
  body?: string | null;
  html_url?: string;
  user?: { login?: string } | null;
}

export function createGitHubIssuesAdapter(
  options: GitHubAdapterOptions = {},
): SourceAdapter {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const tokenOf = options.token ?? (() => process.env.GITHUB_TOKEN);
  const apiBase = (
    options.apiBase ??
    process.env.HAMMURABI_GITHUB_API ??
    "https://api.github.com"
  ).replace(/\/$/, "");

  let cache: { ref: string; doc: Promise<SourceDoc> } | undefined;
  const clear = () => {
    cache = undefined;
  };

  async function load(ref: string): Promise<SourceDoc> {
    if (cache?.ref === ref) return cache.doc;
    const pending = fetchDoc(ref);
    cache = { ref, doc: pending };
    try {
      return await pending;
    } catch (e) {
      if (cache?.doc === pending) cache = undefined;
      throw e;
    }
  }

  async function fetchDoc(ref: string): Promise<SourceDoc> {
    const { owner, repo, number } = parseRef(ref);
    const issue = await request<GhIssue>(
      "GET",
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${number}`,
    );
    const comments: GhComment[] = [];
    for (let page = 1; page <= 20; page++) {
      const batch = await request<GhComment[]>(
        "GET",
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${number}/comments?per_page=100&page=${page}`,
      );
      if (!Array.isArray(batch) || batch.length === 0) break;
      comments.push(...batch);
      if (batch.length < 100) break;
    }
    const body = issue.body ?? "";
    return {
      title: issue.title?.trim() || `${owner}/${repo}#${number}`,
      body,
      tasks: listTasks(body),
      comments: comments.map((c) => ({
        body: c.body ?? "",
        url: c.html_url,
        author: c.user?.login,
      })),
    };
  }

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = tokenOf()?.trim();
    if (!token) {
      throw new HammurabiLockError("GITHUB_TOKEN", "GITHUB_TOKEN is not set", 2);
    }
    const url = `${apiBase}${path}`;
    let res: Response;
    try {
      res = await fetchImpl(url, {
        method,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "User-Agent": "hammurabi",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      throw new HammurabiLockError(
        "network",
        `GitHub API request failed: ${(e as Error).message}`,
        2,
      );
    }
    if (res.status === 404) {
      throw new HammurabiLockError("not-found", `GitHub issue not found: ${path}`, 2);
    }
    if (res.status === 401 || res.status === 403) {
      const text = await res.text();
      if (/rate limit/i.test(text)) {
        throw new HammurabiLockError(
          "network",
          `GitHub API rate limit (${res.status})`,
          2,
        );
      }
      throw new HammurabiLockError(
        "GITHUB_TOKEN",
        `GitHub API rejected credentials (${res.status})`,
        2,
      );
    }
    if (!res.ok) {
      throw new HammurabiLockError(
        "network",
        `GitHub API ${res.status} for ${method} ${path}`,
        2,
      );
    }
    if (res.status === 204) return undefined as T;
    try {
      return (await res.json()) as T;
    } catch (e) {
      throw new HammurabiLockError(
        "network",
        `GitHub API returned non-JSON (${res.status}): ${(e as Error).message}`,
        2,
      );
    }
  }

  return {
    name: "github-issues",
    read(ref) {
      return load(ref);
    },
    async readSelections(ref, proposal) {
      const doc = await load(ref);
      const sections = mergeSections(
        [doc.body, ...doc.comments.map((c) => c.body)],
        proposal,
      );
      const unknown = [...sections.values()].flatMap((s) => s.unknownChecked);
      if (unknown.length > 0) {
        throw new HammurabiLockError(
          "unknown-option",
          `checkbox does not match an option: ${unknown[0]}`,
          1,
        );
      }
      return [...sections.entries()].map(([decisionId, section]) => ({
        decisionId,
        optionIds: section.checked,
      }));
    },
    async publish(ref, proposal) {
      const doc = await load(ref);
      const rendered = renderProposal(proposal);
      const haystack = [doc.body, ...doc.comments.map((c) => c.body)].join("\n");
      if (proposal.decisions.every((d) => haystack.includes(`## ${d.id} `))) {
        return { url: undefined };
      }
      const { owner, repo, number } = parseRef(ref);
      const comment = await request<GhComment>(
        "POST",
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${number}/comments`,
        { body: rendered },
      );
      clear();
      return { url: comment.html_url };
    },
    async postComment(ref, body) {
      const { owner, repo, number } = parseRef(ref);
      const comment = await request<GhComment>(
        "POST",
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${number}/comments`,
        { body },
      );
      clear();
      return { url: comment.html_url };
    },
  };
}

function parseRef(ref: string): { owner: string; repo: string; number: string } {
  const m = /^([^/\s]+)\/([^/\s#]+)#(\d+)$/.exec(ref);
  if (!m) {
    throw new HammurabiLockError(
      "bad-ref",
      `github-issues ref must be owner/repo#N, got "${ref}"`,
      2,
    );
  }
  return { owner: m[1], repo: m[2], number: m[3] };
}
