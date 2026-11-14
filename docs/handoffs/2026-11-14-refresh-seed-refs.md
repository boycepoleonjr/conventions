# Handoff: refresh the template seed refs (v1.8.2)

Branch `chore/refresh-seed-refs`, PR into `main` (v1.8.1). Not released or tagged; `v1` has not moved. Aside tags `v1.8.2` and moves `v1` after Boyce approves.

## Boyce's decisions (applied)

- Hold the `claude-code-action` seed at v1.0.264. The other two refreshes ship.
- Runner floor accepted, and noted in the README ("Versions belong to the repo").
- Leave `allowed_bots: "cursor"` as is.
- This handoff is dated 2026-11-14 to match the CHANGELOG.
- Keep dropping the checkout v4.4.0 hold. `persist-credentials: false` is set on the one checkout step in `claude-code-review.yml` and on the checkout step in each of the other three synced templates, and tests enforce it (see below).

## What I changed

- **Seeds only.** The `uses:` lines in `templates/claude-code-review.yml`, `conventions-check.yml`, `conventions-sync-check.yml` and `deploy-secrets-lint.yml`, and in this repo's own `.github/workflows/test.yml`:
  - `actions/checkout`: v4.4.0 to v7.0.1, `3d3c42e5aac5ba805825da76410c181273ba90b1`.
  - `actions/setup-node`: unchanged in the templates (v7.1.0, `949feb2413d6458794dcd2491c4babbbce0c15c1`, still the newest). `test.yml` moves from v4.4.0 to the same ref.
  - `anthropics/claude-code-action`: **not changed**. The seed stays at v1.0.264, `d70510b174a1244958df0b03166a54912811f3e6`. A newer v1.0.276 exists and is not used.
- **README.** One bullet under "Versions belong to the repo": the checkout and setup-node seeds run on node24 and need Actions runner v2.327.1 or later. GitHub-hosted runners qualify. A repo on an older self-hosted runner updates the runner or sets an older ref in its own workflow, which sync keeps (SUP-7).
- **Docs.** `STANDARD.md` SUP-6 no longer mentions the old v4.4.0 hold. Nothing else needed rewording: README, `global/`, `skills/` and `profiles/` had no leftover "held", "v4.4.0" or "includeIf" text. The dated specs and old CHANGELOG entries still mention v4.4.0 as history, and I left them.
- **Tests.** `test/repo-owned-refs.test.mjs`: the "seed bump" test hardcoded the old checkout SHA as "the existing file's refs". It now captures the repo's refs before and compares after. New test: each action has exactly one seed (full SHA plus version comment) across the templates and `test.yml`.
- `VERSION` 1.8.2 and a CHANGELOG entry. It says synced repos need no action and that a seed-only bump does not require repos to sync.
- No change to `scripts/sync.mjs`, `manifest.json` or any template text other than the checkout `uses:` line.

## How I resolved the refs

I ran `git ls-remote --tags` and cloned each upstream repo, then checked what each tag points at:

- `actions/checkout` v7.0.1 is a lightweight tag. `git cat-file -t` says `commit`, `3d3c42e5…`. Its `action.yml` says `using: node24`. It is the newest tag.
- `actions/setup-node` v7.1.0 is a lightweight tag at `949feb24…`. Nothing newer exists.
- The release page shows checkout v7.0.1 with the "Latest" badge and no pre-release marker.

## Checkout v5, v6 and v7: does anything affect us?

I read the checkout README, CHANGELOG and `action.yml` diff from v4.4.0 to v7.0.1, and the release pages.

- **v5.** Moves to node24. It needs runner v2.327.1 or later. GitHub-hosted runners qualify. This matters only to a new repo on an old self-hosted runner (now documented in the README).
- **v6.** Persisted credentials move to a separate file under `$RUNNER_TEMP`, pulled in through `includeIf`. Running authenticated git from a Docker container action needs runner v2.329.0. Our workflows set `persist-credentials: false`, so nothing is persisted, and none runs git from a container action.
- **v7.0.0.** The module becomes ESM, and checkout refuses fork PR code under `pull_request_target` and `workflow_run`. The four workflows trigger on `pull_request`, `push`, `schedule` and `workflow_dispatch` only. v7.0.1 is bug fixes.
- Our usage (`fetch-depth: 1`, `persist-credentials: false`) uses inputs that are unchanged in `action.yml`.

## The claude-code-action hold

I had checked v1.0.264 to v1.0.276 against the review job (`prompt` mode, `allowed_bots: "cursor"`, read-only `gh` allowlist, no push) and found no applicable breaking item: auto mode is off because `allowed_bots` is set, and the credential-helper change does not matter because we never push through `origin`. I could not run the job live, so Boyce chose to hold the seed. Nothing here depends on that decision: Dependabot moves a repo's own ref whenever the repo wants.

Note for later: if `allowed_bots` is ever removed from the template, v1.0.273 and later default to auto mode and `--allowedTools` stops being a strict list. Boyce said to leave it as is.

With `persist-credentials: false` on the new checkout, the review template still works with v1.0.264. I read that tag's `replaceCheckoutCredentials` (`src/github/operations/git-config.ts`): both the `--unset-all` and the `include.path` clean-up are in try/catch, and a checkout with no persisted header logs "No existing authentication headers to remove" and carries on. The 1.7.0 template already ran this combination (checkout v4.4.0 with `persist-credentials: false` and this action version), so the only new variable is the checkout version, which does not persist anything under this setting.

## `persist-credentials: false`: what enforces it

No new test was needed. Three existing tests cover the review template:

- `repo-owned-refs.test.mjs`, "SUP-6": walks every `actions/checkout` step in all four synced templates and fails if a step lacks `persist-credentials: false`. It also asserts there are exactly four checkout steps.
- `claude-review-fail-loudly.test.mjs`, "kept as before": the rendered review workflow must contain the exact block `fetch-depth: 1` then `persist-credentials: false` under a SHA-pinned checkout.
- `setup-node-pin.test.mjs`: the three templates with setup-node must have the same checkout block.

I removed the `persist-credentials: false` line from the review template and re-ran: the SUP-6 test and the "kept as before" test both failed (2 failures), then I restored the file.

## What I verified

- `node --test test/*.test.mjs`: 134 pass, 0 fail, exit 0 on Node 22.23.4 and on Node 20.20.2.
- The CI Prettier step, reproduced locally with `claude_review.focus` set: `sync --check` exit 0 and `prettier@3 --check` clean on every rendered file. `bash -n scripts/cloud-setup.sh`: exit 0.
- A new repo gets checkout v7.0.1, setup-node v7.1.0 and claude-code-action v1.0.264.
- **Existing repos see no ref change (end to end).** I initialised a repo with the real 1.8.1 conventions (checkout v4.4.0, claude-code-action v1.0.264) and Dependabot-bumped one `setup-node` ref to a fake v7.2.0.
  - Seed-only change (this branch's templates, version left at 1.8.1): `--check` reports `0 to write, 0 conflicts`, exit 0. The 8 `uses:` lines are identical before and after.
  - Full sync to 1.8.2: exit 0. The same 8 lines are identical, including the bumped ref. `--check` afterwards: exit 0.
  - A control (`main` with only `VERSION` set to 1.8.2) shows the same `--check` result lines as this branch. The only drift is the version header every release carries, not the seeds.

## What I could not verify

- The review workflow has not run on GitHub with checkout v7.0.1. It needs `CLAUDE_CODE_OAUTH_TOKEN` and a real PR. checkout v7.0.1 and setup-node v7.1.0 did run in this repo's own `test.yml` on CI (green on the first push). The first live review run will be a downstream repo's first review after it adopts the new seeds.
- This PR does not edit `.github/workflows/claude-code-review.yml` (this repo has only the template), so it needs no `review-waiver`.

## Open items

- Release steps (tag `v1.8.2`, move `v1`) are Aside's, after Boyce approves. This PR creates no tag or release.
- A future seed bump for claude-code-action can be done in any release (README, "Versioning").
