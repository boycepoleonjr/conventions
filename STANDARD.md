# Repository standard

Each item has a stable ID so audits and PRs can reference it. "Synced" means `sync.mjs` installs it; the rest are checked in an audit and fixed by hand or by a dedicated PR.

## DOC: agent and human docs
- **DOC-1** `AGENTS.md` with the shared rules block, the review guidelines block, the commands block, and repo-owned Project and Repo rules sections. *(synced)*
- **DOC-2** `CLAUDE.md` that imports `AGENTS.md` (`@AGENTS.md`), so Claude Code, Cursor and Codex read the same instructions. *(synced)*
- **DOC-3** `docs/specs/` for plans and `docs/handoffs/` for session handoffs. *(synced, seed)*
- **DOC-4** README states what the project is, how to run it, and where it deploys.

## FLOW: engineering workflow
- **FLOW-1** One branch per task, named `<type>/<slug>`. Conventional Commits.
- **FLOW-2** Open a draft PR after the first commit; mark it ready for review once every local check passes and CI is green. AI reviews trigger on ready. A repo may set `pr.draft` to `false` in `.conventions.json` to open PRs non-draft (ready for review) so AI reviews run on every push; the synced `agents-core` block then says so instead.
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
- **CI-4** PR review: the Codex GitHub app reviews every PR automatically (primary). The Claude review workflow reviews every non-draft human PR on open, every push, reopen and ready-for-review (no triage step that can skip the review), re-reviews the full diff on each run and posts only new findings, and fails loudly if its secret is missing; plus on-demand `@claude` from one trigger workflow. Both read the AGENTS.md Review guidelines. No self-hosted Codex workflow. Cursor Bugbot is off by default (per-review cost); enable it per repo for high-risk work. Bot PRs skip AI review instead of failing. The review must fail loudly when it cannot read the whole PR: if `gh pr diff` fails (for example HTTP 406 on a diff over GitHub's 20,000-line limit) it falls back to the paginated PR file list, and a file without a patch or any fetch error makes the review incomplete. The one summary comment carries `review-status: complete <HEAD_SHA>` or `review-status: incomplete <HEAD_SHA> <reason>`, and a final job step fails the check unless the newest bot summary for the head SHA says complete (no summary for that SHA also fails). Draft, fork and bot PRs still skip the job; a skipped job is not a pass, and a repo that requires the check must treat a skipped required check as blocking (durable-agent does). A PR that edits `.github/workflows/claude-code-review.yml` cannot be reviewed by the action (claude-code-action refuses to run when the PR's copy of the workflow differs from the default branch). The workflow detects this first from the PR file list (GET only; a failed call fails the job), skips the action, and its final step then passes only if a human with admin rights on the repository has commented a line exactly `review-waiver: <HEAD_SHA>` for the current head SHA after an independent review. The commenter must be a user (never a bot) and either the repository owner (`author_association` OWNER, user-owned repos) or have the `admin` permission, checked with a GET of `repos/<repo>/collaborators/<login>/permission` (organization owners show up as MEMBER); a failed lookup fails the job. Without a valid waiver the step fails with an error saying so. A waiver for an older SHA, or from anyone without admin rights, does not count, and a new push needs a new waiver. Every other PR is verified as before. Synced as .github/workflows/claude-code-review.yml; repo-specific focus via claude_review.focus.
- **CI-5** Weekly conventions drift check. *(synced)*
- **CI-6** Conventions sync check on every PR and every push to `main`: `.github/workflows/conventions-sync-check.yml` clones the conventions tag pinned in `.conventions.lock.json`, runs `sync.mjs --repo . --check` and fails the job on any `CONFLICT` (a managed file edited by hand). Being behind the pinned release (files that would be updated) is a notice, not a failure. Repo-owned action refs and `node-version` are not edits (SUP-7), so a Dependabot bump passes. A clone or network failure, or a `sync.mjs` that does not finish, fails the job; it is never a pass. Opt out only with `sync-check` in `skip`. The check is named `Conventions sync check` (the job name) and is a required check on the default branch in every repo that syncs it (SET-1): enable it after the sync PR that adds the workflow has merged, and never require it in a repo that has `sync-check` in `skip`. How: README, "Make the check required". *(synced)*

## SUP: supply chain and permissions
- **SUP-1** Third-party actions pinned to a full commit SHA with a version comment (`uses: owner/action@<40-hex sha> # vX.Y.Z`). The pin form is required. Each repo chooses which version (SUP-7), and Dependabot keeps it current. In synced workflows the refs are repo-owned after the first sync: sync keeps them, and drift checks ignore them. A ref that is not a full SHA is drift.
- **SUP-2** Dependabot weekly for github-actions and the package ecosystem. *(synced)*
- **SUP-3** Workflow `permissions:` least privilege, default `contents: read`.
- **SUP-4** Dependency changes are declared openly in the manifest. Never hide a version change inside `overrides`/`resolutions` while the manifest claims a different range; if an override is unavoidable, explain it in the PR. *(skill: dependency-update)*
- **SUP-5** Dependabot opens one grouped minor/patch PR and one grouped major PR per ecosystem weekly. Security updates arrive separately. No ecosystem has an `ignore` rule, so Dependabot proposes every version. Never merge the grouped major PR blindly: split it and do each major deliberately with the dependency-update skill. *(synced)*
- **SUP-6** `actions/checkout` steps set `persist-credentials: false` unless the job itself must push with the checkout token. No checkout token then stays in git config while later steps run, whatever the checkout version, so SUP-6 never restricts which version a repo runs (SUP-7). Actions that need git auth set up their own, as `claude-code-action` does. *(synced workflows)*
- **SUP-7** Conventions never impose dependency, runtime, action or tool versions. Version choice belongs to each repo's lockfile and Dependabot. The only exception is a major security issue (a published advisory or CVE with real exposure for us): the exception must name the advisory, state the minimum safe version as a floor (not an exact pin), and carry a removal condition. Compatibility problems and preferences are not exceptions. SHAs in synced templates are seeds for new files only. *(sync keeps repo refs)*

## DEP: deploy
- **DEP-1** Auto-deploy on merge to the production branch.
- **DEP-2** PR previews where the host supports them.
- **DEP-3** Deploy secrets (cloud API tokens, account ids and any other credential that can change infrastructure or data) live only in GitHub Environments restricted to specific branches ("Selected branches"), plus required reviewers where the plan allows them (private repos on some plans do not), never as repository or organization secrets. Every job that reads one declares `environment:`; a production environment is limited to the production branch, and a new preview branch is added to the environment's branch rule by an owner before it deploys. No `pull_request_target` workflow and no workflow-level `env:` references them. Without required reviewers, anyone who can push to an allowed branch can still read the secrets through a changed workflow, so protect that branch too. Where the host can build and deploy from the repository itself (for example Cloudflare Workers Builds), prefer that: no deploy token lives in GitHub at all. Synced lint: `.github/workflows/deploy-secrets-lint.yml` runs `scripts/lint-workflow-secrets.mjs`, which fails on `secrets.CLOUDFLARE_*` (widen with `--secret`) read by a job without `environment:`; it cannot check repository settings. *(synced)*

## SET: repository settings
- **SET-1** Default branch protected: PR required, required checks (CI-2, and `Conventions sync check` from CI-6 where synced), no force push.
- **SET-2** Squash merge by default; head branches deleted after merge.
