# Handoff: AI attribution scrub and check (v1.9.0)

Branch `claude/wonderful-meitner-g7er66`, PR into `main` (v1.8.2). The PR is the source of truth for status and CI. Not released or tagged: Aside tags `v1.9.0` and moves `v1` after you approve. I did not merge anything.

## What I built

The plan is `docs/specs/2026-11-14-ai-attribution-scrub.md`. I wrote it after the first push, when the Codex review pointed out that FLOW-6 requires a plan in `docs/specs/` and I had only a handoff. It records the decisions as they were made.

- `templates/ai-attribution-scrub.yml`, manifest id `ai-attribution-scrub`, installed as `.github/workflows/ai-attribution-scrub.yml`. Job `scrub`, `actions/github-script` pinned to v9.0.0 (`3a2844b7e9c422d3c10d287c895573f7108da1b3`), permissions `contents: read`, `issues: write`, `pull-requests: write`. It removes the footer from the end of a body and edits only when something changed.
- `templates/ai-attribution-check.yml`, manifest id `ai-attribution-check`, job `AI attribution check`. I made it a separate file, not a second job in the scrub workflow. The reason: the scrub workflow also triggers on `pull_request` `edited`, and a required check whose job is skipped on some events can report "skipped" (which counts as passing) on the same commit after a real failure. A file with only `opened, synchronize, reopened` never has that problem. It needs only `contents: read` and `pull-requests: read`.
- `scripts/ai-attribution.mjs`: `scrubBody` and `commitProblems`, pure functions. Synced repos do not get this file, so each function is copied verbatim into its template between `BEGIN`/`END` markers, and a test fails if a copy drifts. I did this instead of teaching `sync.mjs` to inline scripts, so `sync.mjs` is unchanged.
- STANDARD CI-7 (new), SET-1 mention, README section, CHANGELOG 1.9.0 (2026-11-14), `VERSION` 1.9.0. CI-7 was not in your list; the templates' header comments cite a rule number like CI-6 does, so I added it. Drop it if you would rather not have a rule.

## Choices you should know about

- **Fresh read before edit.** The script re-reads the body with the API instead of trusting the event payload. A PR that is opened and then edited a second later would otherwise have its newer description overwritten by the older payload. A small window remains between that read and the write.
- **Only the end of the body.** The cut is computed on offsets in the original string, so the kept text is returned byte for byte (CRLF and mixed endings included). A footer followed by anything else, even a `---`, is left alone.
- **Session link.** Only `claude.ai/code/session_...` (and `claude.com`) counts, bare, in `<>`, as a markdown link, or after `Claude-Session:`. Other claude.ai links (artifacts, chats) are kept.
- **Read-only tokens.** Fork PRs are skipped with a notice before any API call. A 403 on the edit (Dependabot) is a notice. Any other error fails the job.
- **The check's ignore rules.** Dependabot (author login `dependabot[bot]`) and GitHub merge commits (more than one parent, committed by GitHub) are ignored. A merge made locally by an AI author is still flagged, and a squash or web-edit commit by GitHub with one parent is still checked. A PR whose commit list is shorter than its commit count (the API caps at 250) fails.
- **Trailers only.** The check reads the final trailer block the way `git interpret-trailers` does (Codex P2 on the first review of this PR): a `Co-Authored-By: Claude` line quoted in prose, a code block, or a paragraph followed by more text is not attribution. It is stricter than git in one way: every line of the block must be a trailer, so a mostly-trailer block that git would accept because of a `Signed-off-by` line is not read, and a Claude trailer in it would be missed.
- **Author name rule.** Only the author name `Claude` is flagged, not names that merely contain it (for example "Claude Debussy"). The committer name is not checked; the committer email is.

## What I verified

- `node --test test/*.test.mjs`: 190 pass, 0 fail, exit 0 on Node 22.23.4 (134 before this change, 56 new). I could not run Node 20 here.
- Mutation checks: breaking the separator rule and the "only edit when changed" guard each fail tests. The first mutation exposed a missing case (a `---` after a footer that is not at the end); I added the test and re-ran.
- Trailer-only matching: the five new check tests fail on the previous function (3 of them) and pass on the new one, and a parity test compares the check with `git interpret-trailers --parse` on 13 messages.
- The real workflow scripts, extracted from the templates, run against a fake `github`/`context`/`core` for all five event types, a fork PR, a 403, a stale payload, a clean PR, a failing PR with two bad commits, Dependabot and merge commits, and a truncated commit list.
- Prettier 3 (the CI step, `--no-config`) is clean on every rendered workflow from a fresh `sync.mjs --init`. `sync.mjs --check` after the init is clean, and both new files are written with the version filled in.

## What I could not verify

- The workflows have not run on GitHub. The first live run will show the actual payloads and token permissions, in particular that `issue_comment` and `pull_request_review` edits succeed with `issues: write` and `pull-requests: write`. This repo does not install the new workflows for itself (it has only `test.yml`), so the PR does not exercise them either.
- Until the workflows are synced into a repo, footers on PRs there are still removed by Aside.

## Open items for you

1. Review the CI-7 wording in STANDARD and keep or drop it.
2. After the release, each repo's next sync creates both files. Make `AI attribution check` a required check only after that sync PR has merged (README, "AI attribution scrub and check").
3. Release steps (tag `v1.9.0`, move `v1`) are Aside's, after you approve.
4. Existing Claude Code cloud sessions that already pushed commits with `noreply@anthropic.com` will fail the check on their next PR update; the failure message gives the fix. Repos can skip the check until they are ready.
