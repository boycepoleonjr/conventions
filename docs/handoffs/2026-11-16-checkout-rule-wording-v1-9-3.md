# Handoff: checkout rule wording and sync-tests line (v1.9.3)

Branch `chore/checkout-hold-wording-1-9-3`, PR into `main` (v1.9.2, `4f981d0`). The PR is the source of truth for status.

## What you asked for, and what I found

You asked me to replace every "hold actions/checkout at v4.4.0" instruction with the current rule. I searched every live file and found none: the hold was removed in 1.7.0 (SUP-6 now says `persist-credentials: false` and never restricts the version), and the checkout seed is v7.0.1. The old wording survives only as history in the CHANGELOG, `docs/specs/` and `docs/handoffs/`, and I left it as written. Same result for `claude-code-action` hold wording and Dependabot `ignore` rules.

So the work was to state the current rule where reviewers read it, which nothing did before:

1. Review prompt (`templates/claude-code-review.yml`, step 4): any checkout version is fine, never flag the version, do flag a missing `persist-credentials: false`.
2. `agents-review` block: the same rule as an "Also check" item.
3. `agents-core` block: the line saying sync-managed files are tested upstream and sync-only PRs should not be asked for repo-level tests.
4. STANDARD SUP-6: one sentence for reviewers.

## Checks

- `node --test test/*.test.mjs`: 234 pass, 0 fail (227 before, plus 7 new in `test/checkout-rule-wording.test.mjs`).
- Five mutations each fail the new tests (listed in the CHANGELOG).
- A real `--init` sync renders both rules and a following `--check` is clean.

## Decisions for you

- Release rollout: each synced repo's sync PR edits `claude-code-review.yml`, so it needs one `review-waiver` as for every release.
- I dated the CHANGELOG heading 2026-11-15 as you specified; today's date in the session is 2026-11-16.
