# Global conventions (all projects)

Installed from https://github.com/boycepoleonjr/conventions. Project instructions (`AGENTS.md`, `CLAUDE.md`) refine these defaults; follow the repo where they differ.

## Before changing code
- Find the repository root and read its `AGENTS.md`/`CLAUDE.md`, README, manifests and lockfiles, scripts and CI workflows. Use the repo's real commands and conventions.
- Treat notes and remembered project details as hints. Verify the current branch, default branch, scripts and deploy setup in the repo.
- Do not apply a preferred stack, framework or architecture across unrelated repos. Ask before broad migrations, new toolchains or major dependency upgrades.

## Verification
- Verify by observing real behavior: exit codes, rendered output, response bytes, row counts. "Passes" means the tooling is green and the change was seen doing what it should.
- Report a command's real exit code even when piping output (`set -o pipefail` or `${PIPESTATUS[0]}`). Never hide `git commit` or `git push` errors.
- When results are capped or truncated, say how many items were omitted. Never present a partial result as complete.

## Git and PRs
- Conventional Commits. One branch per task (`<type>/<slug>`). Never work directly on a protected branch.
- Draft PR after the first commit; ready for review only when checks pass and CI is green. Never merge unless explicitly told to merge that PR.
- Verify the actual default and protected branches; do not assume `main`.

## Secrets and sensitive data
- Never read, print or edit `.env*` files (except `.env.example`) or key material. Say which variable to set instead.
- Use synthetic or redacted data in tests, examples, logs and PR text. Treat personal, financial, client and family data as sensitive, even in private repos.
- No production writes or irreversible actions (deploys, destructive migrations, DNS, deleting data) without explicit approval.

## Writing
- Write reviews, analyses and handoffs in first person, addressing the reader as "you", so they can be pasted as-is.
