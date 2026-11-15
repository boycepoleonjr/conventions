# Handoff: no logins in workflow output, deny-by-default everywhere (v1.9.2)

Branch `fix/redact-logins-v1.9.2`, PR into `main` (v1.9.1, squash `80628d9`). The PR is the source of truth for status and CI. Not released or tagged: Aside tags `v1.9.2` and moves `v1` after you approve. I did not merge anything.

Spec: the "v1.9.2" section of `docs/specs/2026-11-14-ai-attribution-scrub.md`.

## What changed

1. **`claude-code-review.yml`, waiver path.** The success warning and the lookup-failure error no longer name anyone: `Waiver accepted from a repo admin for <7-char sha>` and `Could not verify the commenter's permission to check their review-waiver`. The logic is the same; the lookup's stderr is no longer shown (see below).
2. **Scan of all templates** for echoes, annotations and `core.*` calls that print a login, name or email. One more hit: the attribution check named the repo owner's login in its fix text. It now says "the repo owner".
3. **Deny by default for the remaining two.** `conventions-check.yml` (job `drift`) and `deploy-secrets-lint.yml` (job `deploy-secrets`): `permissions: {}` at the workflow level, `contents: read` on the job. All six synced workflows now follow the pattern.
4. VERSION 1.9.2, CHANGELOG `## 1.9.2 (2026-11-15)`, spec section, this note.

## Decisions to check

- **The lookup's stderr is hidden** (`2>/dev/null` on the one `gh api` call that holds the login in its path). I could not confirm from the CLI's source what its error text contains, and the request path is in the URL it can print, so I treated it as a possible leak. The cost is that a failed lookup no longer shows the HTTP status; the job still fails with the new message and can be re-run. If you would rather keep the status and accept the risk, remove the redirect and the test that asserts it.
- **`$REPO` was dropped from the lookup error too.** The repository slug is public and not a commenter's identifier, but you asked for no names, and the message is clearer without it.
- **`waiver_by` is still computed and unused for output.** That keeps the logic identical (the loop's break conditions and the "no waiver" check use it). It is no longer printed.
- **Not changed:** scrub notices include the API's error message on a 403 (`Resource not accessible by integration`), which is GitHub's generic text and holds no identifier. The review action's own output (the model's review text) is not ours to scrub.

## What I verified

- `node --test test/*.test.mjs`: see the PR for the final count and CI. Four mutations each fail the new tests (login back in the warning, login back in the lookup error, the CLI's stderr shown again, a workflow-level scope back in `conventions-check.yml`).
- The real verify step, run through every waiver and lookup path with a fake CLI whose failure text includes the request path: no login, name, email, path or CLI error text reaches the output.
- Prettier 3 and `sync.mjs --init` then `--check` on the rendered workflows.

## What I could not verify

- The workflows have still not run on GitHub. The first live self-edit PR in a synced repo shows the new waiver lines.
- Each repo's sync PR to 1.9.2 edits `claude-code-review.yml` (and every synced file's version header), so it is a self-edit PR needing one `review-waiver`; use the tiny-PR approach in the README.
