# conventions

Engineering conventions for my repositories, written for both people and coding agents (Claude Code, Cursor, Codex). Public on purpose: it holds no secrets, and cloud agent sessions can fetch it without credentials.

## What's here

| Path | Purpose |
|---|---|
| `STANDARD.md` | The baseline every repo is measured against, with stable IDs |
| `templates/` | Files synced into repos (agent docs, PR template, Dependabot, drift check) |
| `profiles/` | Stack defaults: commands and Dependabot ecosystems |
| `skills/` | Shared Claude Code skills, synced to each repo's `.claude/skills/` |
| `global/CLAUDE.md` | User-level agent rules, installed into `~/.claude/` locally and in cloud sessions |
| `scripts/sync.mjs` | Applies the conventions to a repo. Node 20+, no dependencies |
| `scripts/cloud-setup.sh` | Setup script for Claude Code cloud environments |

## Use it in a repo

```bash
git clone --depth 1 --branch v1.1.0 https://github.com/boycepoleonjr/conventions /tmp/conventions
node /tmp/conventions/scripts/sync.mjs --repo . --init   # first time: writes .conventions.json, then syncs
node /tmp/conventions/scripts/sync.mjs --repo .          # later: update to the checked-out version
node /tmp/conventions/scripts/sync.mjs --repo . --check  # report drift, exit 1 if anything would change
```

`sync.mjs` never touches repo-owned content:

- **block** files (for example `AGENTS.md`) only change between `<!-- conventions:begin <id> -->` and `<!-- conventions:end <id> -->` markers. Everything outside the markers belongs to the repo.
- **replace** files are fully managed. If a managed file was edited by hand since the last sync, sync reports `CONFLICT` and leaves it alone unless you pass `--force`.
- **seed** files are created once and never updated.
- **json-merge** files (`.claude/settings.json`) are merged key by key: the managed keys are set, objects merge, arrays are unioned, and every other key in the file is kept. A file that is not a JSON object is a `CONFLICT`. Sync rewrites the file with 2-space JSON only when a managed key is missing or different, so run your formatter afterwards if it reflows arrays.

## Versions belong to the repo

Conventions never choose dependency, runtime, action or tool versions for a repo (STANDARD SUP-7). Each repo's lockfile and Dependabot choose them. The synced `dependabot.yml` has no `ignore` rule.

In the three synced workflows (`claude-code-review.yml`, `conventions-check.yml`, `deploy-secrets-lint.yml`, marked `"refs": "repo"` in `manifest.json`), the version refs are repo-owned after the first write:

- A new file gets the template's refs as seeds.
- On later syncs, each `uses: owner/action@<sha> # <version>` keeps the repo's ref and version comment. Actions are matched by their `uses` path. The repo's `node-version` values are kept too. Everything else in the file is still managed.
- An action that is new to the template gets the template's ref.
- `--check`, the lock hashes and conflict detection ignore those refs. A Dependabot bump is never drift, never a `CONFLICT`, and never needs `--force`, and a sync never downgrades it.
- The pin form is still required (SUP-1). A ref that is not a full 40-hex commit SHA (for example `@v4`) is not ignored: it shows up as drift with a `not a full commit SHA (SUP-1)` note, and the template seed replaces it on the next write.
- Only plain `uses: owner/action@ref` lines are recognized. A quoted ref is treated as ordinary content.

The only exception to SUP-7 is a major security issue: the exception names the advisory, sets a minimum safe version as a floor (not an exact pin), and says when it will be removed.

Each repo records its settings in `.conventions.json` and the last applied version and hashes in `.conventions.lock.json`. Opt out of a file by adding its id to `"skip"`.

## Partial adoption

To adopt only some managed files without full onboarding, pass `--only` with manifest ids (the `id` fields in `manifest.json`, comma-separated):

```bash
node /tmp/conventions/scripts/sync.mjs --repo . --init --only claude-review   # first time: writes .conventions.json, installs and locks only that file
node /tmp/conventions/scripts/sync.mjs --repo . --check --only claude-review  # drift for that file only
node /tmp/conventions/scripts/sync.mjs --repo . --only claude-review --force  # overwrite it if edited by hand
```

`--only` works with `--init`, `--check`, `--force` and plain apply. Files outside the list are neither written nor reported, and the lock keeps their existing entries. A later full `sync.mjs --repo .` works normally and treats files that already match as clean. Unknown ids exit 3.

Repos with a staging-first flow can point Dependabot version updates at that branch. The option is unset by default, so Dependabot targets the default branch:

```json
{ "dependabot_target_branch": "staging" }
```

It adds `target-branch: "staging"` to every ecosystem in the synced `dependabot.yml`. Per GitHub's reference, `target-branch` applies to version updates only; security updates still target the default branch.

The Claude review workflow (`claude-review`, CI-4) reads optional repo-specific focus from `.conventions.json`:

```json
{ "claude_review": { "focus": "Check RLS policies on every new table.\nFlag any new public route without auth." } }
```

## Deploy secrets lint

The synced `deploy-secrets-lint` workflow (DEP-3) runs `scripts/lint-workflow-secrets.mjs` on every PR. It fails when a job reads `secrets.CLOUDFLARE_*` without a job-level `environment:`, when the secret is referenced above `jobs:`, or from a `pull_request_target` workflow. Widen the pattern with `--secret`, for example:

```bash
node /tmp/conventions/scripts/lint-workflow-secrets.mjs --repo . --secret 'CLOUDFLARE_[A-Z0-9_]+|FLY_API_TOKEN'
```

The check is line based (no YAML parser) and expects block-style workflows with 2-space indentation. It fails closed: a secret reference it cannot attribute to a job (4-space indentation, flow-style `jobs: {...}`, a key after `jobs:`) is an error, not a pass. Secret names match case-insensitively, `secrets['NAME']` counts, and `toJSON(secrets)` or `secrets[<expression>]` count as reading every secret. A job that calls a reusable workflow cannot declare `environment:`, so passing a deploy secret to one is flagged (read it in the called workflow's job instead), and `secrets: inherit` into an external reusable workflow is flagged; a local callee is linted as its own file.

Limits: this is a guardrail against mistakes, not a security boundary. A PR can edit or delete the workflow or the script's pinned version, so make the `Deploy secrets lint` check required in branch protection. `workflow_run` workflows (they run with secrets after an untrusted workflow) are not checked beyond the job rules. It cannot see repository or environment settings.

## Cloud sessions

Point a Claude Code cloud environment's setup script at:

```bash
curl -fsSL https://raw.githubusercontent.com/boycepoleonjr/conventions/v1/scripts/cloud-setup.sh | CONVENTIONS_REF=v1 bash || true
```

## Versioning

SemVer tags (`v1.0.0`), plus a moving major **branch** (`v1`, not a tag) that always points at the latest 1.x release. It is a branch because cloud sessions cannot push tags (403); the exact `vX.Y.Z` tags are pushed separately. Cloud environments and the drift check track `v1`; repos record the exact version they applied in `.conventions.lock.json`. Patch: wording fixes. Minor: new rules, files or profiles. Major: a change that needs manual work in repos (renamed markers, removed files). See `CHANGELOG.md`.

## Release

1. Bump `VERSION`, add a `CHANGELOG.md` entry, and run `node --test test/*.test.mjs` on Node 20 and 22.
2. After the PR is approved and merged, push the `vX.Y.Z` tag and move the `v1` branch to it.

The SHAs in the workflow templates are seeds for new files only. Changing a seed alone does not need a release, does not change the template's normalized hash, and causes no `UPDATE` in synced repos: those repos keep their own refs, and Dependabot keeps them current. Update a seed when it is convenient, in any release.
