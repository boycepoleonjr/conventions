# Handoff: refresh the template seed refs (v1.8.2)

Branch `chore/refresh-seed-refs`, draft PR into `main` (v1.8.1). Not released or tagged; `v1` has not moved. Aside tags `v1.8.2` and moves `v1` after you approve.

## What I changed

- **Seeds only.** The `uses:` lines in `templates/claude-code-review.yml`, `conventions-check.yml`, `conventions-sync-check.yml` and `deploy-secrets-lint.yml`, and in this repo's own `.github/workflows/test.yml`:
  - `actions/checkout`: v4.4.0 to v7.0.1, `3d3c42e5aac5ba805825da76410c181273ba90b1`.
  - `anthropics/claude-code-action`: v1.0.264 to v1.0.276, `f3b070c88125d33dbae5653df5f143101d4ea9dc`.
  - `actions/setup-node`: unchanged in the templates (v7.1.0, `949feb2413d6458794dcd2491c4babbbce0c15c1`, still the newest). `test.yml` moves from v4.4.0 to the same v7.1.0 ref.
- **Docs.** `STANDARD.md` SUP-6 no longer mentions the old v4.4.0 hold. Nothing else needed rewording: README, `global/`, `skills/` and `profiles/` had no leftover "held", "v4.4.0" or "includeIf" text. The dated specs and old CHANGELOG entries still mention v4.4.0 as history, and I left them.
- **Tests.** `test/repo-owned-refs.test.mjs`: the "seed bump" test hardcoded the old checkout SHA as "the existing file's refs". It now captures the repo's refs before and compares after. New test: each action has exactly one seed (full SHA plus version comment) across the templates and `test.yml`.
- `VERSION` 1.8.2 and a CHANGELOG entry. It says synced repos need no action and that a seed-only bump does not require repos to sync.
- No change to `scripts/sync.mjs`, `manifest.json` or any template text other than the `uses:` lines.

## How I resolved the refs

I ran `git ls-remote --tags` and cloned each upstream repo, then checked what each tag points at:

- `actions/checkout` v7.0.1 is a lightweight tag. `git cat-file -t` says `commit`, `3d3c42e5…`. Its `action.yml` says `using: node24`. It is the newest tag (the next lower is v7.0.0, and the 6.x line tops out at v6.1.0).
- `anthropics/claude-code-action` v1.0.276 is an annotated tag. Tag object `12043dd…`, dereferenced commit `f3b070c8…` (`git rev-parse v1.0.276^{commit}`). It is the newest `v1.0.x` tag.
- `actions/setup-node` v7.1.0 is a lightweight tag at `949feb24…`, unchanged. Nothing newer exists.
- The release pages show v7.0.1 with the "Latest" badge and no pre-release marker on any release I used.

## Checkout v5, v6 and v7: does anything affect us?

I read the checkout README and CHANGELOG at v7.0.1, the `action.yml` diff from v4.4.0, and the release pages.

- **v5.** Moves to node24. It needs runner v2.327.1 or later. GitHub-hosted runners qualify. This matters only to a new repo on an old self-hosted runner.
- **v6.** Persisted credentials move to a separate file under `$RUNNER_TEMP`, pulled in through `includeIf`. Running authenticated git from a Docker container action needs runner v2.329.0. Our workflows set `persist-credentials: false`, so nothing is persisted, and none runs git from a container action.
- **v7.0.0.** The module becomes ESM, and checkout refuses fork PR code under `pull_request_target` and `workflow_run`. The four workflows trigger on `pull_request`, `push`, `schedule` and `workflow_dispatch` only. v7.0.1 is bug fixes.
- Our usage (`fetch-depth: 1`, `persist-credentials: false`) uses inputs that are unchanged in `action.yml`.

## claude-code-review.yml with the new checkout and the new action

v1.0.273 is labelled breaking upstream. I went through its seven items against our job (`prompt` mode, `allowed_bots: "cursor"`, `--allowedTools` for read-only `gh`, no push):

1. Auto permission mode by default. It does not apply: `defaultsToAutoMode()` returns false when `allowed_bots` is set, so we keep the earlier behavior.
2. `restrict_untrusted_prs`. It only denies code-running commands on PRs from authors without write access. Our job skips fork PRs, and our allowlist has no code-running commands anyway.
3. `allowed_bots` credential helper. The token stays out of `.git/config`. Later steps that push through `origin` need their own credentials. Ours use `gh` with `GH_TOKEN` and never push.
4. Stricter git wrappers. Tag mode (`@claude` runs) only. We use `prompt` mode.
5. Trigger trust. It concerns comment-triggered runs. We run on `pull_request`.
6. Restoring `GITHUB_ENV`, `GITHUB_PATH` and git config after the session. Our workflow passes nothing through them.
7. Signed commits from `prompt` runs. We do not set `use_commit_signing`.

With `persist-credentials: false` there is no checkout header. `replaceCheckoutCredentials` in v1.0.276 handles that case: it logs "No existing authentication headers to remove" and carries on. It then configures the credential helper because `allowed_bots` is set.

## What I verified

- `node --test test/*.test.mjs`: 134 pass, 0 fail, exit 0 on Node 22.23.4 and on Node 20.20.2.
- The CI Prettier step, reproduced locally with `claude_review.focus` set: `sync --check` exit 0 and `prettier@3 --check` clean on every rendered file. `bash -n scripts/cloud-setup.sh`: exit 0.
- Mutation check on the new test: putting the old checkout ref back into one template fails it ("actions/checkout has 2 different seeds").
- **Existing repos see no ref change (end to end).** I initialised a repo with the real 1.8.1 conventions (all refs v4.4.0 and v1.0.264) and Dependabot-bumped one `setup-node` ref to a fake v7.2.0.
  - Seed-only change (this branch's templates, version left at 1.8.1): `--check` reports `0 to write, 0 conflicts`, exit 0. The 8 `uses:` lines are identical before and after.
  - Full sync to 1.8.2: exit 0. The same 8 `uses:` lines are identical, including the bumped `setup-node` ref. `--check` afterwards: exit 0.
  - A brand-new repo gets checkout v7.0.1 and claude-code-action v1.0.276 seeds, and `--check` exit 0.
- Control: `main` with only `VERSION` set to 1.8.2 gives the same `--check` result lines (8 to write, exit 1) as this branch against a repo locked at 1.8.1. That is the version header in every managed file. It is normal for any release and not caused by the seeds. Downstream, `conventions-sync-check.yml` clones the repo's pinned tag, so it never sees it.

## What I could not verify

- The review workflow has not run on GitHub with these refs. It needs `CLAUDE_CODE_OAUTH_TOKEN` and a real PR, which I do not have here. My conclusion rests on the upstream source and release notes above. The first live run will be a downstream repo's first review after it adopts the new seeds.
- I could read the release pages only through a text summary. v1.0.265 to v1.0.267 were not on the page I got. I covered them with `git log v1.0.264..v1.0.276` and the code diff of `action.yml`.
- This PR does not edit `.github/workflows/claude-code-review.yml` (this repo has no such file, only the template), so it is not a self-edit PR and needs no `review-waiver`. A downstream sync PR would only be one if it edits that file; a seed-only release changes no synced file, so it never does.

## Open items

- Release steps (tag `v1.8.2`, move `v1`) are Aside's, after you approve. This PR creates no tag or release.
- The decisions listed in the PR under "Needs Boyce's decision".
