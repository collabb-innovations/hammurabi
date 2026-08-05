# Releasing `@collabb/hammurabi`

Releases are manual and run from a laptop. There is no publish automation, so
the ordering below is the process — `scripts/preflight-publish.mjs` enforces
the parts that are mechanically checkable.

## Invariants

1. **`main` reflects shipped state.** Every published version is an ancestor of
   `main`.
2. **Every published version is tagged**, and the tag points at the exact commit
   that produced the tarball. `npm view @collabb/hammurabi@<v> gitHead` should
   match `git rev-list -n1 v<v>`.
3. **Publish from the repo root, on `main`, after the PR merges.** Never from a
   feature branch.

## Steps

```sh
# 0. Land the work. PR reviewed and merged into main.
git checkout main && git pull

# 1. Bump the version and close out the changelog.
#    Move CHANGELOG's "Unreleased" section under the new version heading.
#    Choose the level deliberately — see below.
npm version <patch|minor|major> --no-git-tag-version

# 2. Verify before committing anything.
npm run typecheck && npm test && npm run build

# 3. Release commit.
git add package.json package-lock.json CHANGELOG.md
git commit -m "chore(release): v$(node -p "require('./package.json').version")"
git push origin main

# 4. Tag the release commit and push the tag.
V="v$(node -p "require('./package.json').version")"
git tag -a "$V" -m "$V — <one-line summary>"
git push origin "$V"

# 5. Publish from the repo root. Preflight runs automatically.
npm publish
```

`npm publish` triggers `prepublishOnly` (preflight) and then `prepack` (build),
so the tarball is always built from the tree you are publishing.

`prebuild` wipes `dist/` first. This matters more than it looks: `tsc` does not
remove output for sources that no longer exist, so compiled files from a feature
branch survive a `git checkout` and would ship in the next tarball. Before this
was added, packing `main` included `dist/runner/applicability.js` — a module
present only on an unmerged branch.

## What preflight refuses

- cwd is not the git root, or is not this package
- HEAD is not on `main`, working tree dirty, or HEAD not pushed to `origin/main`
- `v<version>` tag missing, or pointing at a different commit than HEAD
- the version is already on npm

Override with `PUBLISH_PREFLIGHT_SKIP=1` only in an emergency, and tag the
commit by hand afterwards.

## Choosing the level

While pre-1.0, `minor` carries breaking changes and `patch` is reserved for
fixes that cannot change a gate outcome. Bump `minor` when a release adds schema
surface (a new `Criterion` or `Fixture` field), adds a report field, introduces
a new load-time error, or changes how a fixture scores — any of those can flip a
consumer's gate even when no API signature changed.

## History note

The invariants above are written from failures, not theory. Versions 0.1.0,
0.2.1, 0.2.2 and 0.3.0 were published without tags, and 0.3.0 was published from
a feature-branch commit before its PR merged, which left `main` behind npm.
Tags were backfilled on 2026-08-05; all published versions are now tagged and on
`main`. The one tag without a matching npm release is `v0.0.3`, a real release
point that was tagged but never published.
