# Changelog

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
