import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createGitHubIssuesAdapter,
  HammurabiLockError,
  lock,
  lockPreimage,
  propose,
  registerAdapter,
  select,
  verify,
} from "../src/lock/index.js";
import { canonicalize } from "../src/lock/jcs.js";
import {
  lockJsonSchema,
  proposalJsonSchema,
  selectionJsonSchema,
} from "../src/schema/lock.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const fixtures = join(root, "tests/fixtures/lock");
const NOW = "2026-10-14T22:00:00.000Z";
const DIAGRAM =
  "flowchart LR\n  A-->B\n  click A \"javascript:alert(1)\"\n\u000f";

const source = { adapter: "text", ref: join(fixtures, "tasks.md") };

function childEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  if (!Object.prototype.hasOwnProperty.call(extra, "GITHUB_TOKEN")) delete env.GITHUB_TOKEN;
  if (!Object.prototype.hasOwnProperty.call(extra, "HAMMURABI_GITHUB_API")) {
    delete env.HAMMURABI_GITHUB_API;
  }
  return env;
}

function runCli(
  script: string,
  args: string[],
  extraEnv: NodeJS.ProcessEnv = {},
  stdin?: string,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", script, ...args], {
      cwd: root,
      env: childEnv(extraEnv),
      stdio: [stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      signal: AbortSignal.timeout(20000),
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.stderr.on("data", (d) => {
      stderr += d;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    if (stdin !== undefined) child.stdin.end(stdin);
  });
}

async function proposalFrom(ref = source.ref, draftPath = join(fixtures, "draft.json")) {
  const draft = JSON.parse(await readFile(draftPath, "utf8")) as unknown;
  return propose({ source: { adapter: "text", ref }, draft, now: NOW });
}

test("determinism: RFC 8785 sample canonicalizes to the published UTF-8 bytes", () => {
  const sample = {
    numbers: [333333333.33333329, 1e30, 4.5, 2e-3, 0.000000000000000000000000001],
    string: "\u20ac$\u000F\u000aA'\u0042\u0022\u005c\\\"/",
    literals: [null, true, false],
  };
  const hex = Buffer.from(canonicalize(sample), "utf8").toString("hex");
  const expected = [
    "7b226c69746572616c73223a5b6e756c6c2c747275652c66616c73655d2c226e756d62657273223a",
    "5b3333333333333333332e333333333333332c31652b33302c342e352c302e3030322c31652d3237",
    "5d2c22737472696e67223a22e282ac245c75303030665c6e4127425c225c5c5c5c5c222f227d",
  ].join("");
  assert.equal(hex, expected);
  const reordered = { literals: sample.literals, string: sample.string, numbers: sample.numbers };
  assert.equal(canonicalize(reordered), canonicalize(sample));
});

test("determinism: same proposal and selection lock to one contentHash", async () => {
  const proposal = await proposalFrom();
  const selection = await select({ proposal, source, now: NOW });
  const a = lock({ proposal, selection, now: "2020-01-01T00:00:00.000Z", lockedBy: "ada" });
  const b = lock({ proposal, selection, now: "2026-10-14T23:00:00.000Z", lockedBy: "grace" });
  assert.equal(a.contentHash, b.contentHash);
  assert.match(a.contentHash, /^sha256:[0-9a-f]{64}$/);
  assert.notEqual(a.lockedAt, b.lockedAt);
  assert.equal(a.proposalHash, selection.proposalHash);
  verify(a);
  verify({ ...a, lockedAt: b.lockedAt, lockedBy: "grace" });

  const withFalse = structuredClone(proposal);
  withFalse.decisions[0] = { ...withFalse.decisions[0], multi: false };
  const selectionFalse = await select({ proposal: withFalse, source, now: NOW });
  assert.equal(selectionFalse.proposalHash, selection.proposalHash);
  assert.equal(proposal.decisions[0].multi, undefined);
});

test("tamper: every single-field mutation of the hashed lock fails verify", async () => {
  const proposal = await proposalFrom();
  const selection = await select({ proposal, source, now: NOW });
  const locked = lock({ proposal, selection, now: NOW, lockedBy: "ada" });
  verify(locked);

  const missed: string[] = [];
  for (const mutant of mutations(lockPreimage(locked))) {
    const doc = {
      ...mutant.value,
      contentHash: locked.contentHash,
      lockedAt: locked.lockedAt,
      lockedBy: locked.lockedBy,
    };
    try {
      verify(doc);
      missed.push(mutant.path);
    } catch (e) {
      assert.equal((e as HammurabiLockError).exitCode, 1);
    }
  }
  assert.deepEqual(missed, []);

  const flipped = `${locked.contentHash.slice(0, -1)}${locked.contentHash.endsWith("0") ? "1" : "0"}`;
  assert.throws(() => verify({ ...locked, contentHash: flipped }), /hash-mismatch/);

  const diagram = structuredClone(locked);
  diagram.spec.diagrams![0].text = `${DIAGRAM} `;
  assert.throws(() => verify(diagram), /hash-mismatch/);
});

test("diagram text is stored and hashed as plain data", async () => {
  const proposal = await proposalFrom();
  assert.equal(proposal.diagrams?.[0].text, DIAGRAM);
  assert.equal(proposal.diagrams?.[0].lang, "mermaid");
  const selection = await select({ proposal, source, now: NOW });
  const locked = lock({ proposal, selection, now: NOW });
  assert.equal(locked.spec.diagrams?.[0].text, DIAGRAM);
  const d1 = locked.spec.decisions.find((d) => d.id === "D1");
  assert.deepEqual(d1?.options.map((o) => o.id), ["A"]);
  assert.equal(d1?.options[0].detail, "No LLM");
  const d3 = locked.spec.decisions.find((d) => d.id === "D3");
  assert.deepEqual(d3?.options.map((o) => o.id), ["A", "C"]);
  assert.equal(proposal.decisions[0].options.map((o) => o.id).join(","), "A,B");
});

test("adapter parity: github issue and text list yield the same selection", async () => {
  const proposal = await proposalFrom();
  const markdown = await readFile(source.ref, "utf8");
  const { fetchImpl } = mockGitHub(markdown, []);
  const github = createGitHubIssuesAdapter({
    token: () => "test-token",
    fetch: fetchImpl,
  });
  registerAdapter({ ...github, name: "gh-parity" });
  const fromText = await select({ proposal, source, now: NOW });
  const fromGitHub = await select({
    proposal,
    source: { adapter: "gh-parity", ref: "acme/widgets#7" },
    now: NOW,
  });
  assert.deepEqual(fromGitHub, fromText);
  assert.equal(fromText.sourceEvidence, undefined);
  assert.deepEqual(fromText.choices, [
    { decisionId: "D1", optionIds: ["A"] },
    { decisionId: "D2", optionIds: ["C"] },
    { decisionId: "D3", optionIds: ["A", "C"] },
  ]);
});

test("explicit selection file overrides parsed checkboxes per decision", async () => {
  const proposal = await proposalFrom();
  const explicit = JSON.parse(await readFile(join(fixtures, "explicit.json"), "utf8")) as unknown;
  const picked = await select({ proposal, source, explicit, now: NOW });
  assert.deepEqual(picked.choices, [
    { decisionId: "D1", optionIds: ["B"] },
    { decisionId: "D2", optionIds: ["C"] },
    { decisionId: "D3", optionIds: ["A", "C"] },
  ]);
});

test("github comment checkboxes override the body and LOCK is evidence", async () => {
  const proposal = await proposalFrom();
  const markdown = await readFile(source.ref, "utf8");
  const comment = [
    "**D1 Who authors options?**",
    "",
    "- [ ] A: Caller supplies draft JSON",
    "- [x] B: Optional judge provider",
  ].join("\n");
  const { fetchImpl, calls } = mockGitHub(markdown, [
    { body: comment, html_url: "https://example.test/c/1", user: { login: "ada" } },
    { body: "LOCK", html_url: "https://example.test/c/2", user: { login: "ada" } },
  ]);
  const github = createGitHubIssuesAdapter({ token: () => "test-token", fetch: fetchImpl });
  const choices = await github.readSelections("acme/widgets#7", proposal);
  assert.deepEqual(choices.find((c) => c.decisionId === "D1")?.optionIds, ["B"]);
  registerAdapter({ ...github, name: "gh-evidence" });
  const picked = await select({
    proposal,
    source: { adapter: "gh-evidence", ref: "acme/widgets#7" },
    now: NOW,
  });
  assert.equal(picked.sourceEvidence, "https://example.test/c/2");
  assert.equal(picked.selectedBy, "ada");
  assert.deepEqual(picked.choices[0], { decisionId: "D1", optionIds: ["B"] });
  assert.equal(calls.filter((c) => c.method === "POST").length, 0);
  assert.ok(calls.some((c) => c.auth === "Bearer test-token"));
});

test("refusals: undecided, over-selected, and proposal mismatch exit 1", async () => {
  const proposal = await proposalFrom();
  await assert.rejects(
    () => select({ proposal, source: { adapter: "text", ref: join(fixtures, "tasks-none.md") }, now: NOW }),
    (e: unknown) => e instanceof HammurabiLockError && e.reason === "undecided" && e.exitCode === 1,
  );
  await assert.rejects(
    () => select({ proposal, source: { adapter: "text", ref: join(fixtures, "tasks-over.md") }, now: NOW }),
    (e: unknown) => e instanceof HammurabiLockError && e.reason === "over-selected" && e.exitCode === 1,
  );
  const selection = await select({ proposal, source, now: NOW });
  const mismatched = {
    ...selection,
    proposalHash: `sha256:${"ab".repeat(32)}`,
  };
  assert.throws(
    () => lock({ proposal, selection: mismatched, now: NOW }),
    (e: unknown) => e instanceof HammurabiLockError && e.reason === "proposal-mismatch" && e.exitCode === 1,
  );

  const dir = await mkdtemp(join(tmpdir(), "hammurabi-lock-"));
  const proposalPath = join(dir, "proposal.json");
  const selectionPath = join(dir, "selection.json");
  const badPath = join(dir, "bad-selection.json");
  await writeFile(proposalPath, JSON.stringify(proposal));
  await writeFile(selectionPath, JSON.stringify(selection));
  await writeFile(badPath, JSON.stringify(mismatched));

  const undecided = await runCli("src/cli/select.ts", [
    "--proposal", proposalPath,
    "--source", `text:${join(fixtures, "tasks-none.md")}`,
  ]);
  assert.equal(undecided.code, 1);
  assert.match(undecided.stderr, /^Error: undecided:/);

  const over = await runCli("src/cli/select.ts", [
    "--proposal", proposalPath,
    "--source", `text:${join(fixtures, "tasks-over.md")}`,
  ]);
  assert.equal(over.code, 1);
  assert.match(over.stderr, /^Error: over-selected:/);

  const mismatch = await runCli("src/cli/lock.ts", [
    "--proposal", proposalPath,
    "--selection", badPath,
  ]);
  assert.equal(mismatch.code, 1);
  assert.match(mismatch.stderr, /^Error: proposal-mismatch:/);
  assert.equal(mismatch.stdout, "");
});

test("non-interactive: propose, select, and lock run with stdin closed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hammurabi-lock-"));
  const proposalPath = join(dir, "proposal.json");
  const selectionPath = join(dir, "selection.json");
  const lockPath = join(dir, "lock.json");
  const proposed = await runCli("src/cli/propose.ts", [
    "--source", `text:${source.ref}`,
    "--in", join(fixtures, "draft.json"),
    "--out", proposalPath,
  ]);
  assert.equal(proposed.code, 0, proposed.stderr);
  assert.equal(proposed.stdout, "");
  assert.equal(proposed.stderr, "");
  const selected = await runCli("src/cli/select.ts", [
    "--proposal", proposalPath,
    "--source", `text:${source.ref}`,
    "--out", selectionPath,
  ]);
  assert.equal(selected.code, 0, selected.stderr);
  const first = await runCli("src/cli/lock.ts", [
    "--proposal", proposalPath,
    "--selection", selectionPath,
  ]);
  const second = await runCli("src/cli/lock.ts", [
    "--proposal", proposalPath,
    "--selection", selectionPath,
    "--out", lockPath,
  ]);
  assert.equal(first.code, 0, first.stderr);
  assert.equal(second.code, 0, second.stderr);
  const lockA = JSON.parse(first.stdout) as { contentHash: string };
  const lockB = JSON.parse(await readFile(lockPath, "utf8")) as { contentHash: string };
  assert.equal(lockA.contentHash, lockB.contentHash);
  const verified = await runCli("src/cli/lock.ts", ["--verify", lockPath]);
  assert.equal(verified.code, 0, verified.stderr);
  assert.equal(JSON.parse(verified.stdout).contentHash, lockA.contentHash);

  const tampered = JSON.parse(await readFile(lockPath, "utf8")) as { spec: { title: string } };
  tampered.spec.title = "tampered";
  const tamperPath = join(dir, "tampered.json");
  await writeFile(tamperPath, JSON.stringify(tampered));
  const refused = await runCli("src/cli/lock.ts", ["--verify", tamperPath]);
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /^Error: hash-mismatch:/);

  const draftText = await readFile(join(fixtures, "draft.json"), "utf8");
  const fromStdin = await runCli(
    "src/cli/propose.ts",
    ["--source", `text:${source.ref}`, "--in", "-"],
    {},
    draftText,
  );
  assert.equal(fromStdin.code, 0, fromStdin.stderr);
  assert.equal(JSON.parse(fromStdin.stdout).id, "lock-core");

  const taskText = await readFile(source.ref, "utf8");
  const fromTaskStdin = await runCli(
    "src/cli/select.ts",
    ["--proposal", proposalPath, "--source", "text:-"],
    {},
    taskText,
  );
  assert.equal(fromTaskStdin.code, 0, fromTaskStdin.stderr);
  assert.deepEqual(JSON.parse(fromTaskStdin.stdout).choices, JSON.parse(await readFile(selectionPath, "utf8")).choices);
});

test("adapters are read-only unless publish or post is set", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hammurabi-lock-"));
  const taskCopy = join(dir, "tasks.md");
  const bare = join(dir, "bare.md");
  await writeFile(taskCopy, await readFile(source.ref));
  await writeFile(bare, "# Bare\n");
  const before = await readFile(taskCopy, "utf8");
  const draft = JSON.parse(await readFile(join(fixtures, "draft.json"), "utf8")) as unknown;

  const quiet = await runCli("src/cli/propose.ts", [
    "--source", `text:${taskCopy}`,
    "--in", join(fixtures, "draft.json"),
  ]);
  assert.equal(quiet.code, 0, quiet.stderr);
  assert.equal(await readFile(taskCopy, "utf8"), before);

  const published = await runCli("src/cli/propose.ts", [
    "--source", `text:${bare}`,
    "--in", join(fixtures, "draft.json"),
    "--publish",
  ]);
  assert.equal(published.code, 0, published.stderr);
  assert.match(await readFile(bare, "utf8"), /## D1 Who authors options\?/);

  const proposal = await propose({
    source: { adapter: "text", ref: taskCopy },
    draft,
    now: NOW,
  });
  const selection = await select({
    proposal,
    source: { adapter: "text", ref: taskCopy },
    now: NOW,
  });
  await writeFile(join(dir, "proposal.json"), JSON.stringify(proposal));
  await writeFile(join(dir, "selection.json"), JSON.stringify(selection));
  const lockedQuiet = await runCli("src/cli/lock.ts", [
    "--proposal", join(dir, "proposal.json"),
    "--selection", join(dir, "selection.json"),
  ]);
  assert.equal(lockedQuiet.code, 0, lockedQuiet.stderr);
  assert.equal(await readFile(taskCopy, "utf8"), before);

  const posted = await runCli("src/cli/lock.ts", [
    "--proposal", join(dir, "proposal.json"),
    "--selection", join(dir, "selection.json"),
    "--post",
  ]);
  assert.equal(posted.code, 0, posted.stderr);
  assert.match(await readFile(taskCopy, "utf8"), /LOCK sha256:[0-9a-f]{64}/);

  const { fetchImpl, calls } = mockGitHub(before, []);
  const github = createGitHubIssuesAdapter({ token: () => "test-token", fetch: fetchImpl });
  await github.read("acme/widgets#7");
  assert.equal(calls.filter((c) => c.method !== "GET").length, 0);
  await github.publish("acme/widgets#7", proposal);
  assert.equal(calls.filter((c) => c.method === "POST").length, 1);
});

test("credential and network failures exit 2 and never return an empty source", async () => {
  let fetched = 0;
  const missing = createGitHubIssuesAdapter({
    token: () => "  ",
    fetch: async () => {
      fetched += 1;
      return new Response("[]", { status: 200 });
    },
  });
  await assert.rejects(
    () => missing.read("acme/widgets#7"),
    (e: unknown) => {
      assert.ok(e instanceof HammurabiLockError);
      assert.equal(e.reason, "GITHUB_TOKEN");
      assert.equal(e.exitCode, 2);
      assert.equal(fetched, 0);
      return true;
    },
  );

  const secret = "super-secret-token";
  const rejected = createGitHubIssuesAdapter({
    token: () => secret,
    fetch: async () => new Response(`denied ${secret}`, { status: 401 }),
  });
  await assert.rejects(
    () => rejected.read("acme/widgets#7"),
    (e: unknown) => {
      assert.ok(e instanceof HammurabiLockError);
      assert.equal(e.reason, "GITHUB_TOKEN");
      assert.equal(e.message.includes(secret), false);
      return true;
    },
  );

  const offline = createGitHubIssuesAdapter({
    token: () => "dummy",
    fetch: async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:1");
    },
  });
  await assert.rejects(
    () => offline.read("acme/widgets#7"),
    (e: unknown) => e instanceof HammurabiLockError && e.reason === "network" && e.exitCode === 2,
  );

  const cliCred = await runCli("src/cli/propose.ts", [
    "--source", "github-issues:acme/widgets#7",
    "--in", join(fixtures, "draft.json"),
  ]);
  assert.equal(cliCred.code, 2);
  assert.match(cliCred.stderr, /^Error: GITHUB_TOKEN:/);
  assert.equal(cliCred.stdout, "");

  const cliNet = await runCli(
    "src/cli/propose.ts",
    ["--source", "github-issues:acme/widgets#7", "--in", join(fixtures, "draft.json")],
    { GITHUB_TOKEN: "dummy", HAMMURABI_GITHUB_API: "http://127.0.0.1:1" },
  );
  assert.equal(cliNet.code, 2);
  assert.match(cliNet.stderr, /^Error: network:/);
  assert.equal(cliNet.stdout, "");
  assert.equal(cliNet.stderr.includes("dummy"), false);
});

test("boundary: propose/select/lock ship no provider SDK and no private commands", async () => {
  const files = [
    "src/lock",
    "src/cli/propose.ts",
    "src/cli/select.ts",
    "src/cli/lock.ts",
    "src/cli/json-io.ts",
    "src/schema/lock.ts",
  ];
  const banned = [
    "@anthropic-ai/sdk",
    "@google/genai",
    "from \"openai\"",
    "from 'openai'",
    "collabb-innovations/collabb",
  ];
  for (const rel of files) {
    const full = join(root, rel);
    const paths = (await statWalk(full)).filter((p) => p.endsWith(".ts"));
    for (const path of paths) {
      const text = await readFile(path, "utf8");
      for (const needle of banned) {
        assert.equal(text.includes(needle), false, `${path} imports ${needle}`);
      }
    }
  }
  const commands = (await readdir(join(root, "commands"))).sort();
  assert.deepEqual(commands, ["hammurabi-run.md", "hammurabi.md"]);
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as {
    bin: Record<string, string>;
  };
  assert.deepEqual(Object.keys(pkg.bin).sort(), [
    "hammurabi-check",
    "hammurabi-lock",
    "hammurabi-propose",
    "hammurabi-run",
    "hammurabi-select",
    "hammurabi-verify",
  ]);
  for (const name of ["proposal", "selection", "lock"] as const) {
    const onDisk = JSON.parse(await readFile(join(root, "schema", `${name}.schema.json`), "utf8")) as object;
    const live = name === "proposal" ? proposalJsonSchema : name === "selection" ? selectionJsonSchema : lockJsonSchema;
    assert.deepEqual(onDisk, live);
  }
  assert.equal(proposalJsonSchema.additionalProperties, false);
  assert.ok(proposalJsonSchema.properties && "decisions" in proposalJsonSchema.properties);
  assert.ok(selectionJsonSchema.properties && "proposalHash" in selectionJsonSchema.properties);
  assert.ok(lockJsonSchema.properties && "contentHash" in lockJsonSchema.properties);
});

function mutations(value: unknown): { path: string; value: unknown }[] {
  const out: { path: string; value: unknown }[] = [];
  function walk(node: unknown, assign: (next: unknown) => unknown, path: string): void {
    if (typeof node === "string") {
      out.push({ path, value: assign(`${node}#`) });
      return;
    }
    if (typeof node === "boolean") {
      out.push({ path, value: assign(!node) });
      return;
    }
    if (typeof node === "number") {
      out.push({ path, value: assign(node + 1) });
      return;
    }
    if (Array.isArray(node)) {
      if (node.length > 0) {
        out.push({ path: `${path}#drop-last`, value: assign(node.slice(0, -1)) });
      }
      node.forEach((el, i) => {
        walk(
          el,
          (next) => {
            const copy = node.slice();
            copy[i] = next;
            return assign(copy);
          },
          `${path}[${i}]`,
        );
      });
      return;
    }
    if (node && typeof node === "object") {
      const rec = node as Record<string, unknown>;
      for (const key of Object.keys(rec)) {
        const here = path ? `${path}.${key}` : key;
        walk(rec[key], (next) => assign({ ...rec, [key]: next }), here);
        const dropped = { ...rec };
        delete dropped[key];
        out.push({ path: `${here}#drop`, value: assign(dropped) });
      }
    }
  }
  walk(value, (next) => next, "");
  return out;
}

function mockGitHub(
  body: string,
  comments: { body: string; html_url?: string; user?: { login?: string } }[],
): {
  fetchImpl: typeof fetch;
  calls: { method: string; url: string; auth?: string }[];
} {
  const calls: { method: string; url: string; auth?: string }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    calls.push({ method, url, auth: headers.get("authorization") ?? undefined });
    if (url.includes("/comments") && method === "GET") {
      const page = new URL(url).searchParams.get("page");
      return Response.json(page === "1" || page === null ? comments : []);
    }
    if (method === "POST") {
      return Response.json({ html_url: "https://example.test/comment/1" });
    }
    if (method === "GET") {
      return Response.json({ title: "From GitHub", body });
    }
    return new Response("no", { status: 500 });
  };
  return { fetchImpl, calls };
}

async function statWalk(path: string): Promise<string[]> {
  const { stat } = await import("node:fs/promises");
  const info = await stat(path);
  if (info.isFile()) return [path];
  const entries = await readdir(path);
  const nested = await Promise.all(entries.map((entry) => statWalk(join(path, entry))));
  return nested.flat();
}
