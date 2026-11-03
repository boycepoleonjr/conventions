# Handoff: no imposed dependency versions (v1.7.0, SUP-7)

Branch `feat/no-imposed-versions`, rebased onto `main` at v1.6.3 (`07eb312`), PR into `main`. It has not been released or tagged, and `v1` has not moved. Plan: `docs/specs/2026-11-03-no-imposed-versions.md`.

## What I changed

- **STANDARD.**
  - New SUP-7: conventions impose no dependency, runtime, action or tool versions. The only exception is a named advisory, with a floor and a removal condition.
  - SUP-1 now says the SHA form is required and the repo chooses the version.
  - SUP-5 says there is no `ignore` rule.
  - SUP-6 swaps the checkout v4.4.0 hold for `persist-credentials: false`.
- **Dependabot.** `CHECKOUT_IGNORE` is gone from `sync.mjs`. The rendered `dependabot.yml` has no `ignore` rule.
- **Workflows.** Every `actions/checkout` step in the three synced workflows sets `persist-credentials: false`. Each workflow also gets a header comment saying its refs are repo-owned.
- **`sync.mjs`.** The manifest marks the three workflows `"refs": "repo"`. For those files:
  - Sync keeps the repo's SHA refs (with their version comments) and its `node-version` values.
  - Drift, lock hashes and conflict detection use normalized text.
  - A new file, or an action that is new to the template, gets the seed.
  - A ref that is not a full SHA is flagged and never adopted.
  - A pre-1.7.0 lock (raw hash) is still treated as unedited when the file matches it as is, or matches it with its refs reset to the seeds.
- **Wording.** The dependency-update skill, `global/CLAUDE.md` and the `agents-core` block now say "do not pin or cap to satisfy conventions; floor only for a documented major security issue".
- **Docs.** README has new "Versions belong to the repo" and "Release" sections. CHANGELOG has a 1.7.0 entry, and `VERSION` is 1.7.0.

## What I verified

- `node --test test/*.test.mjs` after the rebase onto 1.6.3: 92 pass, 0 fail, exit 0 on Node 22.23.4 and Node 20.20.2.
- End-to-end after the rebase, against the real 1.6.3 (`07eb312`) and 1.6.2 (`651c5bb`) trees. Each repo was initialized with the old version, optionally bumped Dependabot-style, then synced with 1.7.0:
  - From 1.6.3, untouched: 3 workflow UPDATEs with refs kept, 0 conflicts, apply exit 0, `--check` exit 0.
  - From 1.6.3, bumped: the same result, with the bumped refs kept.
  - From 1.6.2, untouched: 3 workflow UPDATEs, 0 conflicts. The repo keeps setup-node v4.4.0, and Dependabot proposes the bump.
  - From 1.6.2, bumped: CONFLICT on `conventions-check.yml` and `deploy-secrets-lint.yml` (apply exit 2). One `--force` gives 0 conflicts with the bumped refs kept, then `--check` exits 0. This is the documented edge case.
- The CI Prettier step, reproduced locally: rendered files with focus and repo-owned text, then `--check` exits 0 and `prettier@3 --check` is clean.
- `test/setup-node-pin.test.mjs` (from 1.6.3) now checks the pin form (40-char SHA plus a version comment), not the exact version. A file that differs only in its setup-node ref is OK, not drift.
- End-to-end against the real v1.6.2 tree (`git archive` of `651c5bb`), before the rebase. I initialized a repo with 1.6.2, then bumped checkout to v7.0.1 and setup-node to v6.0.0 the way Dependabot would.
  - 1.6.2 `--check` reports 3 CONFLICTs.
  - 1.7.0 `--check` reports UPDATE with "repo action refs kept" and 0 conflicts.
  - Apply exits 0, the bumped refs stay, and `persist-credentials: false` is added.
  - A second `--check` exits 0.
- Mutation checks:
  - Dropping the pre-1.7.0 seed-reset check fails the upgrade test.
  - Writing template refs instead of adopted refs fails 4 tests.
  - Normalizing non-SHA refs fails the SUP-1 tests.
- `claude-code-action` v1.0.264 source (`src/github/operations/git-config.ts`, `src/modes/agent/index.ts`, `src/entrypoints/run.ts`):
  - `prepareAgentMode` always runs `configureGitAuth` or `replaceCheckoutCredentials`. These tolerate a missing header and set `origin` to the action's own token (from the OIDC exchange).
  - That happens before `restoreConfigFromBase` runs `git fetch origin <base>`. So the review works without persisted checkout credentials.
  - Its header cleanup only reads `include.path`. Checkout v6+ (I checked v7.0.1, `src/git-auth-helper.ts`) writes `includeIf.gitdir:<gitdir>.path`, so with persisted credentials the token would survive on v6+. Checkout v4.4.0 still writes the header to the local config.

## Decisions (Boyce)

- Ship `persist-credentials: false` as the replacement for the checkout v4.4.0 hold.
- Bump the seed SHAs in a later patch, in a follow-up PR.
- Aside moves `v1` to v1.6.3 with a main -> v1 merge PR, the same way as #13. I did not touch `v1`: my direct fast-forward push was rejected because `v1` carries the #13 merge commit.

## Open items for you

- Follow-up patch: bump the seeds (checkout, setup-node, claude-code-action) to current releases. With 1.7.0 this causes no UPDATE in synced repos.
- Edge case: a repo locked at 1.6.2 whose setup-node ref Dependabot already bumped gets a CONFLICT on `conventions-check.yml` and `deploy-secrets-lint.yml`. Run `sync.mjs --repo . --force` once; it keeps the repo's refs. See the CHANGELOG.
- After release, watch the first `claude-review` run in a synced repo to confirm it is green with `persist-credentials: false`. I could not run the action in this session.
- This repo's own `.github/workflows/test.yml` still uses a checkout without `persist-credentials: false`. It is not synced, so I left it alone (minimal diff).
