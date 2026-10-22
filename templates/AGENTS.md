# AGENTS.md: {{project.name}}

Instructions for any coding agent (Claude Code, Cursor, Codex) and for people working in this repo. The blocks between `conventions` markers are synced from https://github.com/boycepoleonjr/conventions; edit everything else here.

<!-- conventions:begin agents-core -->

## Shared rules (conventions v{{conventions.version}})

- Read this file, the README, `package.json` or equivalent, and `.github/workflows/` before changing code. Use the repo's real commands.
- One branch per task (`<type>/<slug>`), Conventional Commits, minimal diffs: no refactors or unrelated edits in a fix PR.
- Open a draft PR after the first commit. Mark it ready for review only when every command below passes and CI is green; AI reviews trigger on ready. Never merge.
- PR description follows `.github/pull_request_template.md`: what, why, every command run with its real pass/fail, risk, and decisions needed.
- Bug fixes add regression tests for every path of the fix (empty, invalid, valid input, and any guard you add), not just the reported repro. See `.claude/skills/fix-with-regression-tests`.
- Dependency changes are declared openly in the manifest. Never hide a version change in `overrides` or `resolutions` while the manifest claims a different range. See `.claude/skills/dependency-update`.
- Non-trivial work gets a plan in `docs/specs/` first. End each session with a handoff in `docs/handoffs/YYYY-MM-DD-<topic>.md`.
- Never commit secrets, real customer data or `.env` files. Use synthetic data in tests and fixtures.
- Deploy secrets (cloud tokens, account ids) live only in GitHub Environments restricted to specific branches (plus required reviewers where the plan allows), never as repository or organization secrets. Every job that reads them declares `environment:`; a new deploy branch is added to the environment's branch rule by an owner first; never reference them from `pull_request_target` or at workflow level.
- Standard: https://github.com/boycepoleonjr/conventions/blob/v{{conventions.version}}/STANDARD.md

<!-- conventions:end agents-core -->

<!-- conventions:begin agents-review -->

## Review guidelines

For AI reviewers (Codex, Claude, Cursor) and people. Report real defects with a concrete failing scenario. Skip style nits that lint already covers.

Treat as P1 (blocking):

- Secrets, API or write keys, tokens or credentials in source, config or client bundles, even if they look like placeholders.
- User-controlled input (query params, form fields, headers) reaching HTML (`dangerouslySetInnerHTML`, `innerHTML`), SQL, shell commands, redirects or file paths without escaping or validation.
- Personal data (names, emails, phone numbers, addresses, IDs) written to logs, `console.*`, analytics events or error reporters.
- A request or promise with no error handling, where failure shows a success message, leaves the UI stuck or causes an unhandled rejection.
- Validation that an alternate path skips (a second submit button, an API route, a shortcut).
- Version changes hidden in `overrides` or `resolutions`, or any other break of the shared rules above.

Also check:

- Off-by-one errors in indexes, ranges, modulo wraparound and pagination.
- Stale closures in React effects, intervals and handlers; missing cleanup.
- Bug fixes without a regression test for each path of the fix.
- Non-trivial features without a plan in `docs/specs/`.

Do not flag behavior-preserving refactors (renames, function style, reordering).

<!-- conventions:end agents-review -->

## Project

{{project.summary}}

- Stack: TODO
- Hosting and deploy: TODO
- Default branch and protection: TODO

<!-- conventions:begin agents-commands -->

## Commands

Run all of these before marking a PR ready, and report each with pass/fail:

{{commands_list}}

<!-- conventions:end agents-commands -->

## Repo rules

Repo-specific rules and known issues go here. They override the shared rules where they conflict.
