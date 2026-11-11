# Handoff: self-edit waiver and sync check (v1.8.0)

Branch `feat/self-edit-waiver-and-sync-check`, PR into `main` (v1.7.0). Not released or tagged; `v1` has not moved. Plan: `docs/specs/2026-11-04-self-edit-waiver-and-sync-check.md`.

## What I changed

- **`templates/claude-code-review.yml`.** New first step `Detect self-edit` (GET of the PR file list, fails loudly). `Run Claude Code Review` is skipped when the PR edits the workflow. `Verify the review was complete` takes a self-edit branch that passes only on a `review-waiver: <HEAD_SHA>` comment from a human who is the repo owner (OWNER) or has admin permission (looked up with a GET; a failed lookup fails the job). Non-self-edit PRs run the 1.7.0 logic unchanged.
- **`templates/conventions-sync-check.yml`** (manifest id `sync-check`, STANDARD CI-6). PR and push-to-main. Clones the pinned tag and runs `sync.mjs --check`. Fails on `CONFLICT`, on a missing `summary:` line, on exit codes other than 0 or 1, and on clone failure. "N to write" is a notice.
- **`pr.draft`** in `.conventions.json` (`scripts/sync.mjs`, `templates/AGENTS.md`, `skills/open-pr/SKILL.md`).
- **Docs.** Spec, STANDARD (CI-4, CI-6, FLOW-2), CHANGELOG 1.8.0, README sections, `VERSION` 1.8.0.
- **Tests.** Extended `claude-review-fail-loudly`; new `sync-check-workflow`; `pr.draft` tests in `sync.test.mjs`. Four old assertions were updated and are listed in the CHANGELOG: three-to-four workflows in `repo-owned-refs.test.mjs` (two places) and `setup-node-pin.test.mjs`, and the step-order assertion in `sync.test.mjs`, because the spec makes Detect the first step.

## What I verified

- `node --test test/*.test.mjs`: 126 pass, 0 fail, exit 0 on Node 22.23.4 and on Node 20.20.2.
- `bash -n scripts/cloud-setup.sh`: exit 0. The CI Prettier step reproduced locally with `claude_review.focus` and `pr.draft: false` set: `sync --check` exit 0 and `prettier@3 --check` clean on all rendered files, including the new workflow.
- Mutation checks on both workflow templates: each of 13 mutations fails at least one test (see the spec).
- A copy of boycepoleonjr/bitburner at `main` (`c4cc9b9`, locked at 1.6.2):
  - The new check script with the pinned `v1.6.2` clone: `CONFLICT` on `conventions-check.yml` only, exit 1. The only difference from the 1.6.2 template is the `actions/setup-node` ref Dependabot bumped to v7.1.0 (PR 36).
  - With this branch's `sync.mjs --force` (at 1.8.0): 8 files written, 0 conflicts, lock 1.6.2 to 1.8.0. The check against a 1.8.0 clone then reports 0 to write, 0 conflicts, exit 0, and still exit 0 after a Dependabot-style checkout bump in all four workflows.
  - With `pr.draft: false` the block carries the non-draft line. bitburner's own "PR policy" section is untouched, and now duplicates the rule.

## What I could not verify

- The workflows have not run on GitHub. I cannot trigger `claude-code-action` here, so the skip on self-edit PRs is checked by structure and by running the real verify script with a fake `gh`, not by a live run. The first real run is bitburner's sync PR.
- `author_association` values and the `collaborators/<login>/permission` response (`permission`: admin, write, read, none) are taken from GitHub's documentation. I did not post a comment or call the endpoint on GitHub to see live values, and I did not confirm that the default job token can call it (the job asks for `contents`, `pull-requests`, `issues` read; the endpoint needs metadata only, which every token has). A failed lookup fails the job, so the risk is a red check, not a false pass.

## Open items

- Release steps (tag `v1.8.0`, move `v1`), per the PR body.
- Decided by Boyce: `Conventions sync check` is a required check downstream. Each repo enables it after its sync PR merges (README, "Make the check required"). I did not change any repo's branch protection.
- Waiver trade-off: agents running with an admin's token can post it, and an admin PR author can waive their own PR.
- Version: 1.8.0, as Boyce decided.
- Seed bumps (checkout, setup-node, claude-code-action) are still pending from the 1.7.0 handoff.
