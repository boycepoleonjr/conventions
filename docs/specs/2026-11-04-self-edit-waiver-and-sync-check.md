# Self-edit waiver for the Claude review, and a PR-time sync check (v1.7.1)

## Problem

1. **The review cannot run on PRs that edit its own workflow.** boycepoleonjr/bitburner PR 38 (sync v1.3.0 to v1.6.2) edited `.github/workflows/claude-code-review.yml`. `claude-code-action` refuses to run when the PR's copy of the workflow differs from the default branch ("Skipping action due to workflow validation ... must have identical content to the version on the default branch"). The 1.6.0 `Verify the review was complete` step then correctly failed: "No Claude review summary ... so this PR was not reviewed." No re-run can clear it, because the cause is the PR's content. 1.7.0 changes `claude-code-review.yml` again (`persist-credentials: false`), so every downstream 1.7.0 sync PR would be red the same way. The 1.6.0 spec does not cover this case.
2. **Hand edits of managed files are not caught before merge.** bitburner PR 36 (Dependabot) edited the managed `conventions-check.yml`. `sync.mjs --check` then reported `CONFLICT` on `main`, and nothing flagged it first: `conventions-check.yml` runs weekly and never fails. 1.7.0 makes Dependabot ref bumps non-drift (repo-owned refs), so the remaining gap is genuine hand edits of managed files.

## Design

### A. Self-edit waiver (`templates/claude-code-review.yml`, CI-4)

Rule: never a green check on a review that did not happen. A self-edit PR passes only on an explicit waiver from a repository admin for the current head SHA.

- **First step, `Detect self-edit`** (`id: self_edit`). `gh api repos/$REPO/pulls/$PR_NUMBER/files --paginate --jq '.[].filename, (.[].previous_filename // empty)'`, GET only, same token scopes as the job. It writes `self_edit=true` to `$GITHUB_OUTPUT` when `.github/workflows/claude-code-review.yml` is an exact line in the list, else `self_edit=false`. If the call fails, the step prints `::error::` and exits 1, and no output is written. `previous_filename` is included so that renaming the workflow away also counts. This is one addition to the specified command: a rename changes the file on the default branch just as an edit does.
- **`Run Claude Code Review`** has `if: steps.self_edit.outputs.self_edit != 'true'`. It is the only conditional step.
- **`Verify the review was complete`** stays unconditional. It still makes its one GET of the PR's issue comments and gets `SELF_EDIT` from the step output.
  - `SELF_EDIT` is `true`: pick the comments with `user.type == "User"` (never a bot) and a body line (CRLF stripped) exactly equal to `review-waiver: <HEAD_SHA>`. Pass if one of their authors has `author_association == "OWNER"` (user-owned repo, no lookup) or, for the others in turn, `gh api repos/$REPO/collaborators/$login/permission --jq .permission` (GET only) returns exactly `admin`. A lookup that fails prints `::error::` and exits 1; it is never skipped in favour of another commenter. If nobody qualifies: `::error::`: this PR edits the review workflow, Claude cannot review it, an independent review is required, and a repository admin (the owner) must comment `review-waiver: <HEAD_SHA>`. A pass logs `::warning::No Claude review ran ... <login> waived it for <sha>`, never "Review complete". A Claude summary on a self-edit PR is not accepted in place of the waiver. Logins that are not plain GitHub logins (`[A-Za-z0-9-]+`) are ignored, so a comment author name never reaches the lookup path.
  - Anything else (`false`, empty, unset): the 1.7.0 logic, with the same single GET of the PR's comments. The permission lookup sits inside the self-edit branch, so a normal PR never makes it. A waiver, from an owner or an admin, is ignored on a normal PR.
- Exact-line matching means quoting, backticks, bold, a prefix, a different case, or an older or longer SHA do not count. A new push changes the head SHA, so it needs a new waiver.

### B. PR-time sync check (`templates/conventions-sync-check.yml`, manifest id `sync-check`, CI-6)

- Triggers: `pull_request`, and `push` to `main` (the same shape as `deploy-secrets-lint.yml`). `permissions: contents: read`. Checkout with `persist-credentials: false`. setup-node, then clone the tag in `.conventions.lock.json` into `$RUNNER_TEMP/conventions`, then `node .../scripts/sync.mjs --repo . --check`.
- Decision table for the `Check managed files` step:

| `sync.mjs --check` result | Job |
|---|---|
| any `CONFLICT` line | fail, `::error::` names the files |
| exit 1, no `CONFLICT`, `summary:` line present ("N to write") | pass, `::notice::` |
| exit 0 with `summary:` line | pass |
| exit 2 or 3, a signal, an uncaught exception, or no `summary:` line | fail, "did not finish" |
| clone fails (network, missing tag) | fail in `Fetch pinned conventions` |
| missing or unparseable lock file | fail in `Fetch pinned conventions` |

  The summary-line requirement matters: an uncaught exception also exits 1, which would otherwise look like "behind".
- The exit code is captured with `if node ...; then code=0; else code=$?; fi`, because GitHub's default shell is `bash -e` and would stop the script at the exit 1 of a repo that is merely behind.
- Repo-owned refs (1.7.0, manifest `"refs": "repo"`): the file is a `refs: repo` workflow like the other three. A Dependabot bump of any ref or `node-version` normalizes away and passes. A ref that is not a full SHA is still a conflict (SUP-1), and the check fails.
- Opt-out: `"sync-check"` in `skip` only. No other id or setting disables it.
- Seeds follow the others (checkout v4.4.0, setup-node v7.1.0). SUP-7: no `ignore` rule, no cap, nothing imposed.

### C. `pr.draft`

`.conventions.json` accepts `"pr": {"draft": false}` (default `true`). `AGENTS.md` carries `{{pr_policy_line}}` where the draft-first line was. The default renders the old line character for character, so default repos see no change. `false` renders "Open the PR non-draft (ready for review) so AI reviews run on every push. Run every command below and keep CI green before each push. Never merge." Any other value exits 3. The synced `open-pr` skill defers to the block.

## Decisions

- Waiver authority is a human with admin rights on the repository. `author_association` alone is not enough: it is `OWNER` only for repos owned by a user account, while an organization owner's comment is `MEMBER`, so an OWNER-only rule could never pass there and every review-workflow change would stay red. The commenter's repository permission settles it: `admin` passes, `write`, `maintain`, `triage` and `read` do not. `OWNER` still passes without a lookup. It needs no extra secret and no allow-list to maintain, and it cannot be satisfied by a bot.
- A permission lookup that fails (HTTP error, missing token scope) fails the job loudly instead of falling back to a weaker rule.
- The waiver is per head SHA, so a force-push or new commit after the independent review invalidates it.
- Detection uses the PR file list, not a diff of the workflow against `main`, because the file list is exactly what the action's validation compares and needs no checkout of two trees.
- The sync check clones the pinned tag, not the latest one. A repo behind the latest release is already reported weekly by `conventions-check`; the PR-time check answers a different question, "did someone edit what the pinned release manages".
- Only `main` is covered for `push`, like `deploy-secrets-lint.yml`. A repo with another default branch edits that line (the file's `on:` is managed, so it would be a conflict; such a repo should skip `sync-check` or ask for a setting). No such repo exists today.
- Version number: Boyce asked for 1.7.1. By the README's rule (new files and rules are minor) this could be 1.8.0. Decision for Boyce.

## Rollout

1. Merge, then Aside tags `v1.7.1` and moves `v1`. No tag or release is created in this PR.
2. Each repo's next sync gets: `UPDATE` of `claude-code-review.yml` and `AGENTS.md` (the block text is unchanged unless `pr.draft` is set), `CREATE` of `conventions-sync-check.yml`, and the `open-pr` skill.
3. That first sync PR edits `claude-code-review.yml`, so it is a self-edit PR: it needs one `review-waiver: <HEAD_SHA>` from a repo admin after an independent review. Advice in the README: put the workflow-file update in its own tiny PR, so the rest of the sync gets a real Claude review.
4. bitburner on `main` (locked at 1.6.2) shows `CONFLICT` on `conventions-check.yml` only, caused by the Dependabot setup-node bump. One `sync.mjs --force` in the sync PR fixes it and keeps the repo's refs. Afterwards the sync check is clean. bitburner can then set `pr.draft: false` and delete its hand-written "PR policy" section.
5. Making `Conventions sync check` a required check in branch protection is a per-repo choice.

## Rollback

- Revert the PR and release 1.7.2, or in one repo add `sync-check` to `skip` and delete the workflow file; nothing else depends on it.
- A repo that cannot use the waiver (see below) can skip `claude-review` and the repo keeps its own copy.
- The `pr.draft` change is inert unless the setting is used; removing the setting restores the draft line on the next sync.

## Known limits

- The waiver is an attestation, not proof of an independent review. Anyone able to comment as an admin, including an agent running with an admin's token, can post it, and an admin who authored the PR can waive their own PR. The check keeps the failure visible and the act deliberate; it does not enforce review.
- The permission lookup uses the job's `GITHUB_TOKEN`; the collaborator-permission endpoint needs only metadata read, which every token has. I could not exercise it on GitHub from here. If a repo's token cannot read it, the lookup fails and the job fails loudly rather than waiving.
- The files endpoint returns at most 3000 files. If the workflow is past that cutoff, detection says `false`, the action then refuses to run, no summary is posted, and the verify step fails as it does today. That fails closed.
- A managed file deleted by hand is reported as `CREATE`, a notice, not a failure.
- A comment can be edited by its author after the fact; the check reads the comment at job time.

## Test plan

`node --test test/*.test.mjs` on Node 20 and 22. Real scripts are extracted from the templates and run with a fake `gh` or `git`, or against the real `sync.mjs`:

- Self-edit detection: edited, renamed-away, removed, later page, look-alike paths, empty list, endpoint failure with no output.
- Self-edit verify: a user-owned OWNER waiver passes with no lookup; an org MEMBER with admin passes; a MEMBER with write, maintain, triage, read or none fails; a failing lookup fails loudly; none, stale SHA (also from an admin), prefix or longer SHA, bots (including a bot with OWNER or admin), malformed lines, odd logins, a Claude summary alone, and a comments-endpoint failure all fail. Normal PRs: complete passes; missing, incomplete, duplicate, malformed and human-spoof fail; an owner waiver does not help.
- Sync check: template contract, skip handling, CONFLICT fails (replace, block, the check workflow itself), behind-but-clean passes, Dependabot bumps pass (and fail when mixed with a hand edit), non-SHA ref fails, fake sync outputs and crashes fail, clone failure fails, lock errors fail.
- `pr.draft`: default unchanged, `false` text, hand-written line untouched, invalid values exit 3.
- Mutation checks: removing the admin check, loosening it to write, dropping the lookup-failure exit, the user-type check, the login check, the OWNER shortcut, the exact-line match, the SHA in the waiver, the skip condition, the `CONFLICT` failure, the summary guard, the exit-code capture or `persist-credentials: false` each fails at least one test.
