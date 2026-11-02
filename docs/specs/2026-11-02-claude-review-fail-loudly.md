# claude-review fails loudly on an unreadable diff (v1.6.0, CI-4)

## Problem

On 2026-11-01 a downstream PR's combined diff was over GitHub's 20,000-line limit, so `gh pr diff` returned HTTP 406. The `claude-review` job still concluded success, and its summary said it only covered what it could read. A green check on a review that did not happen breaks the fail-loudly rule: never miss anything, fail instead of silently skipping.

## Design

- **Fallback.** If `gh pr diff` fails for any reason, the reviewer runs `gh api repos/<repo>/pulls/<n>/files --paginate` (GET only) and reviews file by file from each `patch`. That endpoint is added to `--allowedTools`, scoped to this PR.
- **Incomplete when** a file has no `patch`, a `gh` call fails and is not recovered, the number of files read differs from `changedFiles` (the API returns at most 3000), or the reviewer cannot finish.
- **Recovered 406 is not a failure.** The one failed `gh pr diff` replaced by the fallback does not count. A failure of the fallback itself does.
- **Rename exemption.** A pure rename (`changes` 0, nothing to read) has no patch and does not make the review incomplete.
- **Status line.** The one summary comment contains exactly one line: `review-status: complete <HEAD_SHA>` or `review-status: incomplete <HEAD_SHA> <short reason>`.
- **Verify step.** A last job step (GET only, `github.token`, same scopes) lists the PR's issue comments and keeps bot comments that name the head SHA and carry a `review-status:` line. It takes the newest and exits 1 with `::error::` unless there is exactly one status line and it reads `complete <HEAD_SHA>`. No such comment, a fetch error, or a malformed line also fails.
- **Bot-only filter.** Human comments are ignored, so nobody can type the status line to get a green check. Bot comments without a status line (deploy previews, other reviewers) are ignored so they cannot hide the summary.
- **Unchanged.** Checkout v4.4.0, action SHA pin, `permissions: {}` with job-level permissions, concurrency with cancel-in-progress. Draft, fork and bot PRs still produce a skipped job. durable-agent treats a skipped required check as blocking.

## Decisions (Boyce)

- Bot-only filter is OK. Aside watches the first real run.
- Keep the pure-rename exemption.
- Stale-SHA rerun edge case accepted for now. Follow-up: include the run id in the summary comment.
- "GET only" stays a prompt rule, because `allowedTools` matches by prefix.

## Test plan

`test/claude-review-fail-loudly.test.mjs` (run with `node --test test/*.test.mjs` on Node 20 and 22):

- Template contract: status-line wording, fallback command, recovered-failure wording, pins, permissions, concurrency, skips.
- `allowedTools`: the files endpoint is present and PR-scoped, and there is no blanket `gh api`.
- Verify script run against a fake `gh`: complete passes; incomplete, missing, stale SHA, duplicate or malformed line, human spoof and fetch error fail; newest wins across pages; unrelated bot comments are ignored.

Not covered: a live run on a real oversized PR. That is the first-run watch above.

## Rollout

1. Merge to `main`. Aside publishes v1.6.0 and fast-forwards the `v1` branch. No tag is created from a cloud session.
2. Synced repos receive the changed `.github/workflows/claude-code-review.yml` at the monthly sync.
3. A PR whose review comes back incomplete shows a red check until a re-run or push gives a complete one.

## Rollback

Revert the merge commit and release v1.6.1. Repos that already synced get the previous workflow on their next sync.
