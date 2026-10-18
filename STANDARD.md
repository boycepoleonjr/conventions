# Repository standard

Each item has a stable ID so audits and PRs can reference it. "Synced" means `sync.mjs` installs it; the rest are checked in an audit and fixed by hand or by a dedicated PR.

## DOC: agent and human docs
- **DOC-1** `AGENTS.md` with the shared rules block, the commands block, and repo-owned Project and Repo rules sections. *(synced)*
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
- **CI-4** Claude review on PR ready plus on-demand `@claude`; one trigger workflow. Codex or Cursor review as second reviewer on important repos. Bot PRs skip AI review instead of failing.
- **CI-5** Weekly conventions drift check. *(synced)*

## SUP: supply chain and permissions
- **SUP-1** Third-party actions pinned to a full commit SHA.
- **SUP-2** Dependabot weekly for github-actions and the package ecosystem. *(synced)*
- **SUP-3** Workflow `permissions:` least privilege, default `contents: read`.
- **SUP-4** Dependency changes are declared openly in the manifest. Never hide a version change inside `overrides`/`resolutions` while the manifest claims a different range; if an override is unavoidable, explain it in the PR. *(skill: dependency-update)*

## DEP: deploy
- **DEP-1** Auto-deploy on merge to the production branch; secrets live only in the host or repo secrets.
- **DEP-2** PR previews where the host supports them.

## SET: repository settings
- **SET-1** Default branch protected: PR required, required checks, no force push.
- **SET-2** Squash merge by default; head branches deleted after merge.
