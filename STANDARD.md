# Repository standard

Each item has a stable ID so audits and PRs can reference it. "Synced" means `sync.mjs` installs it; the rest are checked in an audit and fixed by hand or by a dedicated PR.

## DOC: agent and human docs
- **DOC-1** `AGENTS.md` with the shared rules block, the review guidelines block, the commands block, and repo-owned Project and Repo rules sections. *(synced)*
- **DOC-2** `CLAUDE.md` that imports `AGENTS.md` (`@AGENTS.md`), so Claude Code, Cursor and Codex read the same instructions. *(synced)*
- **DOC-3** `docs/specs/` for plans and `docs/handoffs/` for session handoffs. *(synced, seed)*
- **DOC-4** README states what the project is, how to run it, and where it deploys.

## FLOW: engineering workflow
- **FLOW-1** One branch per task, named `<type>/<slug>`. Conventional Commits.
- **FLOW-2** Open a draft PR after the first commit; mark it ready for review once every local check passes and CI is green. AI reviews trigger on ready.
- **FLOW-3** PR description uses the PR template: what, why, commands run with pass/fail, risk, and decisions needed. *(synced)*
- **FLOW-4** Minimal diffs: no refactors or unrelated edits in a fix PR.
- **FLOW-5** Agents never merge. Humans (or an orchestrator acting under explicit rules) merge.
- **FLOW-6** Non-trivial work gets a plan in `docs/specs/` before code.

## TEST: verification
- **TEST-1** A bug fix adds regression tests covering every path of the fix: empty, invalid and valid input, plus any guard added. Not just the reported repro. *(skill: fix-with-regression-tests)*
- **TEST-2** Report the real exit code of every check; never claim a pass you did not observe.

## CI: continuous integration
- **CI-1** Install from the lockfile with one package manager per repo.
- **CI-2** Required checks on the default branch: lint, typecheck, tests, build.
- **CI-3** Secret scanning and a dependency audit (high severity fails).
- **CI-4** PR review: the Codex GitHub app reviews every PR automatically (primary). The Claude review workflow reviews every non-draft human PR on open, every push, reopen and ready-for-review (no triage step that can skip the review), re-reviews the full diff on each run and posts only new findings, and fails loudly if its secret is missing; plus on-demand `@claude` from one trigger workflow. Both read the AGENTS.md Review guidelines. No self-hosted Codex workflow. Cursor Bugbot is off by default (per-review cost); enable it per repo for high-risk work. Bot PRs skip AI review instead of failing. Synced as .github/workflows/claude-code-review.yml; repo-specific focus via claude_review.focus.
- **CI-5** Weekly conventions drift check. *(synced)*

## SUP: supply chain and permissions
- **SUP-1** Third-party actions pinned to a full commit SHA.
- **SUP-2** Dependabot weekly for github-actions and the package ecosystem. *(synced)*
- **SUP-3** Workflow `permissions:` least privilege, default `contents: read`.
- **SUP-4** Dependency changes are declared openly in the manifest. Never hide a version change inside `overrides`/`resolutions` while the manifest claims a different range; if an override is unavoidable, explain it in the PR. *(skill: dependency-update)*
- **SUP-5** Dependabot opens one grouped minor/patch PR and one grouped major PR per ecosystem weekly. Security updates arrive separately. Never merge the grouped major PR blindly: split it and do each major deliberately with the dependency-update skill. The one exception is `actions/checkout`, whose majors are ignored (held at v4.4.0, see CHANGELOG 1.4.0). *(synced)*
- **SUP-6** `actions/checkout` is held at v4.4.0 by SHA and Dependabot ignores its majors (v6+ persists the token through `includeIf.gitdir`, which `claude-code-action` does not clear). The risk: a security fix shipped only in a newer checkout major gets no Dependabot PR. Once a quarter, check the checkout releases and security advisories by hand and decide whether the pin can move. *(ignore rule synced)*

## DEP: deploy
- **DEP-1** Auto-deploy on merge to the production branch.
- **DEP-2** PR previews where the host supports them.
- **DEP-3** Deploy secrets (cloud API tokens, account ids and any other credential that can change infrastructure or data) live only in protected GitHub Environments with a required reviewer, never as repository or organization secrets. Every job that reads one declares `environment:`; a production environment is limited to the production branch. No `pull_request_target` workflow and no workflow-level `env:` references them. Synced lint: `.github/workflows/deploy-secrets-lint.yml` runs `scripts/lint-workflow-secrets.mjs`, which fails on `secrets.CLOUDFLARE_*` (widen with `--secret`) read by a job without `environment:`. *(synced)*

## SET: repository settings
- **SET-1** Default branch protected: PR required, required checks, no force push.
- **SET-2** Squash merge by default; head branches deleted after merge.
