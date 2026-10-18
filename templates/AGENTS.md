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
- Standard: https://github.com/boycepoleonjr/conventions/blob/v{{conventions.version}}/STANDARD.md
<!-- conventions:end agents-core -->

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
