#!/usr/bin/env node
/**
 * Publish preflight. Runs from `prepublishOnly`, so it gates `npm publish`
 * and stays out of the way of `npm pack` / `npm install`.
 *
 * Every check here corresponds to something that actually went wrong:
 *
 *   - 0.3.0 was published from 66216b3, a feature-branch commit, before its PR
 *     merged. The tree happened to match main, so the artifact was fine — but
 *     that is luck, not process.
 *   - 4 of the first 7 published versions were never tagged, so there was no
 *     way to answer "what source produced this tarball" from the repo alone.
 *   - main sat behind npm for a month as a result.
 *
 * Escape hatch: PUBLISH_PREFLIGHT_SKIP=1 npm publish. Intended for a genuine
 * emergency; if you use it, tag the commit afterwards by hand.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const RELEASE_BRANCH = "main";
const PKG_NAME = "@collabb/hammurabi";

if (process.env.PUBLISH_PREFLIGHT_SKIP === "1") {
  console.warn(
    "[preflight] SKIPPED via PUBLISH_PREFLIGHT_SKIP=1 — tag the release commit by hand.",
  );
  process.exit(0);
}

const problems = [];
const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8" }).trim();

// 1. Publishing from the package root, not a subdirectory. npm resolves the
//    nearest package.json upward, so a stray `npm publish` in dist/ or docs/
//    would otherwise publish the root package from an unexpected cwd.
const cwd = process.cwd();
const pkgPath = resolve(cwd, "package.json");
if (!existsSync(pkgPath)) {
  console.error(`[preflight] no package.json in ${cwd} — run npm publish from the repo root.`);
  process.exit(1);
}
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
if (pkg.name !== PKG_NAME) {
  problems.push(`cwd package is '${pkg.name}', expected '${PKG_NAME}' — wrong directory`);
}
const gitRoot = git("rev-parse", "--show-toplevel");
if (resolve(gitRoot) !== resolve(cwd)) {
  problems.push(`cwd ${cwd} is not the git root ${gitRoot} — publish from the repo root`);
}

const version = pkg.version;
const tag = `v${version}`;

// 2. On the release branch, in sync with origin, with nothing uncommitted.
const branch = git("rev-parse", "--abbrev-ref", "HEAD");
if (branch !== RELEASE_BRANCH) {
  problems.push(`on branch '${branch}', not '${RELEASE_BRANCH}' — merge the PR first, then publish from ${RELEASE_BRANCH}`);
}
if (git("status", "--porcelain") !== "") {
  problems.push("working tree is dirty — commit or stash before publishing");
}
try {
  git("fetch", "origin", RELEASE_BRANCH, "--tags", "--quiet");
  const local = git("rev-parse", "HEAD");
  const remote = git("rev-parse", `origin/${RELEASE_BRANCH}`);
  if (local !== remote) {
    problems.push(`HEAD (${local.slice(0, 7)}) != origin/${RELEASE_BRANCH} (${remote.slice(0, 7)}) — push or pull first`);
  }
} catch {
  problems.push("could not reach origin to verify HEAD is pushed");
}

// 3. The version being published is tagged, and the tag is this commit. This
//    is what makes a published version traceable back to source.
let tagged = false;
try {
  git("rev-parse", "--verify", `refs/tags/${tag}`);
  tagged = true;
} catch {
  problems.push(`tag ${tag} does not exist — create it with: git tag -a ${tag} -m "${tag} — <summary>" && git push origin ${tag}`);
}
if (tagged) {
  const tagCommit = git("rev-list", "-n1", tag);
  const head = git("rev-parse", "HEAD");
  if (tagCommit !== head) {
    problems.push(`tag ${tag} points at ${tagCommit.slice(0, 7)}, HEAD is ${head.slice(0, 7)} — tag the commit you are publishing`);
  }
}

// 4. Not already on npm. Republishing a version is refused by the registry
//    anyway; failing here gives a clearer message before the build runs.
try {
  const published = JSON.parse(
    execFileSync("npm", ["view", PKG_NAME, "versions", "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }),
  );
  if (published.includes(version)) {
    problems.push(`${version} is already published — bump the version in package.json`);
  }
} catch {
  // Registry unreachable or package unpublished; not worth blocking on.
}

if (problems.length > 0) {
  console.error(`\n[preflight] refusing to publish ${PKG_NAME}@${version}:\n`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error(`\nSee RELEASING.md. Override with PUBLISH_PREFLIGHT_SKIP=1 if this is an emergency.\n`);
  process.exit(1);
}

console.log(`[preflight] ok — publishing ${PKG_NAME}@${version} from ${RELEASE_BRANCH} @ ${tag}`);
