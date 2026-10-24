# Changelog

## 1.4.0 (2026-10-22)
- Behavior change in the synced `dependabot.yml`: the `github-actions` ecosystem now ignores `actions/checkout` for `version-update:semver-major`. Checkout is held at v4.4.0 on purpose: v6+ persists the token through `includeIf.gitdir`, which `claude-code-action` does not clear, so the token would stay usable during the Claude run. This is a deliberate, narrow exception to the "no `ignore` rule" decision in 1.1.0: only `actions/checkout`, only major version updates, no other dependency or ecosystem. A security fix that ships only in a newer checkout major will not get a Dependabot PR; check checkout's releases and advisories by hand once a quarter (new STANDARD rule SUP-6) and decide whether the pin can move.
- The dependabot test now allows exactly that rule and still fails on any other `ignore`.
- Synced repos get a one-time `UPDATE` of `.github/dependabot.yml` on the next sync.

## 1.3.1 (2026-10-19)
- Every rendered managed file is now Prettier 3 clean (defaults): blank lines around the synced block markers and headings in `AGENTS.md`, `CLAUDE.md` and the PR template, and an aligned table in the PR template. Wording and rules are unchanged; only whitespace differs. Synced repos get a one-time `UPDATE` of the managed blocks on the next sync (no hand edits are touched).
- `sync.mjs` keeps exactly one blank line around a block it inserts or wraps (retrofit and missing-block paths), so repo-owned text next to a block does not make Prettier fail.
- The test workflow renders every managed file with a realistic config (non-empty commands, review focus), appends repo-owned text after the blocks, checks that a re-sync is clean, and runs `prettier@3 --check` on all rendered files (replaces the claude-review-only step).

## 1.3.0 (2026-10-18)
- Behavior change in the synced `claude-review` workflow (CI-4): it now also runs on every push (`synchronize`). A newer push cancels the older run and the newer run reviews the full diff, so nothing is skipped.
- A missing `CLAUDE_CODE_OAUTH_TOKEN` now fails the job loudly (first step, `::error::` with the fix) instead of skipping the review. Repos without the secret should add it or add `claude-review` to `skip`.
- The review prompt always reviews the full PR diff, reads existing PR comments and inline review comments first (`gh pr view --comments`, `gh api .../pulls/N/comments --paginate`, GET only), does not repeat findings that are posted and still apply, and ends with one summary comment that says first review or re-review (with the head SHA) and "No new issues found" when there is nothing new. `gh api` is allowed only for this PR's review-comments path; "GET only" is a prompt rule because the allowedTools syntax matches by prefix.
- `timeout-minutes` 20 -> 30. `allowed_bots` uses double quotes so the rendered file is Prettier 3 clean; the repo's test workflow now renders the template (with and without focus) and runs `prettier@3 --check` on it.
- STANDARD CI-4 updated.

## 1.2.0 (2026-10-18)
- New synced workflow `.github/workflows/claude-code-review.yml` (manifest id `claude-review`, mode `replace`, all profiles, skippable): reviews every non-draft same-repo human PR on open, reopen and ready-for-review, reads the AGENTS.md Review guidelines, always posts one summary comment. `anthropics/claude-code-action` is pinned to a full commit SHA (v1.0.253, 5eb090f3c3afd701a0672cd32981197ca27688f6); checkout stays at v4.4.0. Repo-specific focus comes from `claude_review.focus` in `.conventions.json`.
- `sync.mjs --only <id>[,<id>...]` for partial adoption with `--init`, `--check`, `--force` and apply; only listed files are written and locked, a later full sync treats matching files as clean. Documented in the README.
- `sync.mjs` template rendering only substitutes `{{ word.word }}`; GitHub `${{ ... }}` expressions pass through untouched. A placeholder alone on its line that renders empty drops the line.
- STANDARD CI-4 notes the synced workflow and `claude_review.focus`.

## 1.1.0 (2026-10-18)
- New synced `agents-review` block in `AGENTS.md` (after `agents-core`): "Review guidelines" with P1 blocking criteria and extra checks, read by AI reviewers and people. `sync.mjs` inserts the block into existing `AGENTS.md` files right after the previous block, leaving all other text unchanged.
- CI-4 rewritten from a PR-review benchmark: Codex GitHub app is the primary reviewer; the Claude review workflow covers every non-draft human PR with no skippable triage step, plus on-demand `@claude`; both read the Review guidelines; no self-hosted Codex workflow; Cursor Bugbot off by default.
- Dependabot: every ecosystem now has two version-update groups, `minor-and-patch` and `major`, each with `applies-to: version-updates`, so weekly updates arrive as one grouped minor/patch PR and one grouped major PR. No `ignore` rule: ignoring majors would also filter security updates per GitHub's reference. `applies-to: version-updates` keeps security updates out of the groups, so they stay separate and unaffected. The grouped major PR is never merged blindly; split it and do each major with the dependency-update skill (new rule SUP-5). Source: https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference (see `groups` / `applies-to`, and `ignore`).
- Wording fix: the moving major line `v1` is a branch, not a tag (cloud sessions get 403 pushing tags). Exact `vX.Y.Z` tags are unchanged.

## 1.0.0 (2026-10-18)
- First release: STANDARD.md baseline, agent docs (AGENTS.md blocks + CLAUDE.md import), PR template, Dependabot by profile, docs/specs and docs/handoffs seeds, weekly drift-check workflow, three shared skills (open-pr, fix-with-regression-tests, dependency-update), global CLAUDE.md, sync.mjs, cloud-setup.sh.
- Rules from A/B runs AB-001 and AB-002: cover every path of a fix with tests; declare dependency changes openly; draft PR first, ready for review once green.
