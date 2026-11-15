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
| `scripts/ai-attribution.mjs` | Pure functions behind the AI attribution scrub and check (copied into their workflow templates; tests keep the copies identical) |
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

In the six synced workflows (`ai-attribution-check.yml`, `ai-attribution-scrub.yml`, `claude-code-review.yml`, `conventions-check.yml`, `conventions-sync-check.yml`, `deploy-secrets-lint.yml`, marked `"refs": "repo"` in `manifest.json`), the version refs are repo-owned after the first write:

- A new file gets the template's refs as seeds.
- Runner floor: the current checkout and setup-node seeds run on the node24 runtime, which needs GitHub Actions runner v2.327.1 or later. GitHub-hosted runners qualify. A repo on an older self-hosted runner updates the runner, or sets an older ref in its own workflow; refs are repo-owned, so sync keeps it (SUP-7).
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

A repo that wants PRs opened ready for review (so AI reviews run on every push) sets the PR policy instead of keeping a hand-written line outside the managed block:

```json
{ "pr": { "draft": false } }
```

The default is `true`, which keeps the draft-first rule. Only `true` and `false` are accepted.

## Conventions sync check

The synced `conventions-sync-check.yml` workflow (CI-6) runs on every PR and on pushes to `main`. It clones the conventions tag pinned in `.conventions.lock.json`, runs `sync.mjs --repo . --check`, and fails on any `CONFLICT`: a managed file edited by hand. Being behind the pinned release (files that would be updated) is a notice, and Dependabot bumps of action refs or `node-version` are never edits (SUP-7). If the clone fails, or `sync.mjs` does not finish, the job fails; it is never a pass. Opt out with `"sync-check"` in `skip`.

### Make the check required

The check is named `Conventions sync check` (the job name). Every repo that syncs it makes it a required check on the default branch (STANDARD SET-1), so a hand-edited managed file cannot merge. Being behind the pinned release only produces a notice, so requiring it does not block repos that are merely out of date.

1. Merge the sync PR that adds `.github/workflows/conventions-sync-check.yml` first. GitHub only offers a check that has run in the repo, and a required check that never reports leaves every PR stuck on "Expected".
2. Add the check to the default branch's protection:
   - **Branch protection rule** (Settings, Branches, edit the rule for the default branch): turn on "Require status checks to pass before merging", search for `Conventions sync check` and select it, then save.
   - **Ruleset** (Settings, Rules, Rulesets): in the ruleset for the default branch, turn on "Require status checks to pass" and add `Conventions sync check`.
   - **From the command line**, for a classic rule that already exists (needs admin rights on the repo; replace `OWNER/REPO` and the branch):

```bash
echo '{"contexts":["Conventions sync check"]}' | gh api -X POST repos/OWNER/REPO/branches/main/protection/required_status_checks/contexts --input -
```

3. A repo that has `sync-check` in `skip` must not require the check, and must remove it from the required list if it was added.

If the check goes red, its log names the managed file: revert the edit, change the template in this repo, or add that file's id to `skip`. Dependabot bumps of action refs and `node-version` never fail it.

To resolve a failure, revert the hand edit, change the template in this repo instead, or skip the file id in `.conventions.json`.

## AI attribution scrub and check

Cloud coding sessions append a footer to the PR descriptions, comments and reviews they write (`🤖 Generated with [Claude Code](...)`, a `Co-Authored-By` line, a `claude.ai/code/session_...` link), and to commits they make (`Co-Authored-By` and `Claude-Session` trailers, a bot author). There is no setting that turns this off everywhere, and the rule "no AI attribution" (in `AGENTS.md`) cannot stop a footer the platform adds after the agent has finished. So nobody, human or agent, should clean this up by hand. Two synced workflows (CI-7) do it:

- **`ai-attribution-scrub.yml`** (job `scrub`) runs when a PR, issue, comment or review is opened, created, submitted or edited, and removes the footer. It cuts only from the end of the body: a trailing `Generated with/by <tool>` line for Claude Code, Codex, Cursor, Copilot or Jules (with or without the robot emoji and the link), any `---` separator and blank lines directly above it, trailing `Co-Authored-By:` lines naming one of those agents, and a trailing `claude.ai/code/session_...` link line. A body that is only a footer is left as is, with a notice, instead of being edited to empty. Text in the middle of a body is never touched, and a body with no footer is not edited. It reads the body again right before editing, so a newer edit is not overwritten. Edits made with `GITHUB_TOKEN` do not start new workflow runs, so it cannot loop. On a fork PR, or any run whose token cannot write (Dependabot), it exits 0 with a notice and edits nothing. Permissions are denied at the workflow level and granted to the job: `contents: read`, `issues: write`, `pull-requests: write`.
- **`ai-attribution-check.yml`** (job `AI attribution check`) runs on every PR update and fails, in red, naming each bad commit SHA, if any commit in the PR was authored or committed by an AI coding agent (Claude, Codex, Cursor Agent, Copilot, Jules or Gemini, by name, GitHub login or email, for example `noreply@anthropic.com`, `codex@openai.com`, `cursoragent@cursor.com`, `198982749+Copilot@users.noreply.github.com`, `google-labs-jules[bot]`), or has a `Co-Authored-By` trailer naming one, or a `Claude-Session` trailer. Only the final trailer block of a message counts. Dependabot, `github-actions[bot]` and merge commits made by GitHub are ignored. A commit list the API did not return in full also fails: unchecked is not a pass. Read-only (`contents: read`, `pull-requests: read`). The list of agents is one data structure, `AI_AGENTS` in `scripts/ai-attribution.mjs`; any `@openai.com` address counts as an agent identity.

The scrub cannot rewrite commits, which is why the check exists. When it fails, no force push is needed: re-push the same changes on a new branch with commits authored by the repo owner, open a new PR from it, and close the old one. The failure message prints the steps:

```bash
git fetch origin && git switch -c <new-branch> origin/main
git merge --squash origin/<old-branch>
git commit    # with the repo owner's user.name and user.email, and no AI Co-Authored-By or Claude-Session lines
git push -u origin <new-branch>
```

Opt out of either file by adding its id (`ai-attribution-scrub`, `ai-attribution-check`) to `skip` in `.conventions.json`.

### Make the check required

Like the sync check, a repo can make `AI attribution check` a required check on the default branch, so a PR with AI-authored commits cannot merge. Use the same steps as "Make the check required" above, with the name `AI attribution check`: merge the sync PR that adds `.github/workflows/ai-attribution-check.yml` first (GitHub only offers a check that has run), then add it to the branch protection rule or ruleset. From the command line, for a classic rule that already exists:

```bash
echo '{"contexts":["AI attribution check"]}' | gh api -X POST repos/OWNER/REPO/branches/main/protection/required_status_checks/contexts --input -
```

A repo that has `ai-attribution-check` in `skip` must not require it.

## PRs that edit the review workflow

`claude-code-action` refuses to run when a PR changes `.github/workflows/claude-code-review.yml`, so Claude cannot review that PR. The synced workflow detects it from the PR file list, skips the action, and fails the check with an explanation unless a repository admin has commented a line exactly `review-waiver: <HEAD_SHA>` for the current head commit, after an independent review. The commenter must be a human user and either the repository owner (`author_association` OWNER, on a repo owned by a user account) or someone whose permission on the repo is `admin` (looked up with a GET of `repos/<repo>/collaborators/<login>/permission`; owners of an organization are MEMBER, so they pass through that lookup). If the lookup fails, the check fails. A waiver for an older commit, from a bot, or from anyone with less than admin permission (write, maintain, triage, read) does not count, so every push needs a new one. The first sync PR in a repo that changes `claude-code-review.yml` needs one waiver.

In sync PRs, put the update to `claude-code-review.yml` in its own tiny PR. The rest of the sync then gets a real Claude review, and only the small workflow PR needs the waiver. For example: run `sync.mjs --repo . --only claude-review` for the tiny PR, get the waiver and merge it, then run a full `sync.mjs --repo .` on a fresh branch from `main` for everything else.

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
