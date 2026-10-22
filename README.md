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

Each repo records its settings in `.conventions.json` and the last applied version and hashes in `.conventions.lock.json`. Opt out of a file by adding its id to `"skip"`.

## Partial adoption

To adopt only some managed files without full onboarding, pass `--only` with manifest ids (the `id` fields in `manifest.json`, comma-separated):

```bash
node /tmp/conventions/scripts/sync.mjs --repo . --init --only claude-review   # first time: writes .conventions.json, installs and locks only that file
node /tmp/conventions/scripts/sync.mjs --repo . --check --only claude-review  # drift for that file only
node /tmp/conventions/scripts/sync.mjs --repo . --only claude-review --force  # overwrite it if edited by hand
```

`--only` works with `--init`, `--check`, `--force` and plain apply. Files outside the list are neither written nor reported, and the lock keeps their existing entries. A later full `sync.mjs --repo .` works normally and treats files that already match as clean. Unknown ids exit 3.

The Claude review workflow (`claude-review`, CI-4) reads optional repo-specific focus from `.conventions.json`:

```json
{ "claude_review": { "focus": "Check RLS policies on every new table.\nFlag any new public route without auth." } }
```

## Deploy secrets lint

The synced `deploy-secrets-lint` workflow (DEP-3) runs `scripts/lint-workflow-secrets.mjs` on every PR. It fails when a job reads `secrets.CLOUDFLARE_*` without a job-level `environment:`, when the secret is referenced above `jobs:`, or from a `pull_request_target` workflow. Widen the pattern with `--secret`, for example:

```bash
node /tmp/conventions/scripts/lint-workflow-secrets.mjs --repo . --secret 'CLOUDFLARE_[A-Z0-9_]+|FLY_API_TOKEN'
```

The check is line based (no YAML parser) and expects block-style workflows with 2-space indentation.

## Cloud sessions

Point a Claude Code cloud environment's setup script at:

```bash
curl -fsSL https://raw.githubusercontent.com/boycepoleonjr/conventions/v1/scripts/cloud-setup.sh | CONVENTIONS_REF=v1 bash || true
```

## Versioning

SemVer tags (`v1.0.0`), plus a moving major **branch** (`v1`, not a tag) that always points at the latest 1.x release. It is a branch because cloud sessions cannot push tags (403); the exact `vX.Y.Z` tags are pushed separately. Cloud environments and the drift check track `v1`; repos record the exact version they applied in `.conventions.lock.json`. Patch: wording fixes. Minor: new rules, files or profiles. Major: a change that needs manual work in repos (renamed markers, removed files). See `CHANGELOG.md`.
