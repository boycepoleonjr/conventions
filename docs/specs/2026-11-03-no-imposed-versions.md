# No imposed dependency versions (v1.7.0, SUP-7)

## Problem

Synced files carry exact version pins, and every sync re-applies them. Dependabot bumps a pin in a synced repo, the next sync calls that a hand edit (`CONFLICT`), and a forced sync downgrades it again. Example: a forced sync reverted Dependabot's `actions/setup-node` bump in luminon-bot. The synced `deploy-secrets-lint.yml` pins the old version again, so Dependabot and every later sync keep undoing each other. Each round costs agent work in every repo.

The `actions/checkout` major-version ignore in the synced `dependabot.yml` is a second hold of the same kind.

## Policy

New rule SUP-7: conventions never impose dependency, runtime, action or tool versions. Each repo's lockfile and Dependabot choose the version. The only exception is a major security issue: a published advisory or CVE that really affects us. The exception names the advisory, states a minimum safe version as a floor (not an exact pin), and says when it will be removed. Compatibility problems and preferences do not count.

SUP-1 keeps the pin form (full commit SHA plus a version comment). The repo chooses the version, and Dependabot maintains it.

## Design

- **Dependabot.** Drop `CHECKOUT_IGNORE` from `sync.mjs`. No ecosystem has an `ignore` rule.
- **Checkout hardening without a hold.** Every `actions/checkout` step in the three synced workflows sets `persist-credentials: false`. Checkout then removes its auth in its own `finally` (checkout `src/git-source-provider.ts`), so no `extraheader`, credentials file or `includeIf.gitdir` entry outlives the step, whatever the checkout version.
  - claude-code-action v1.0.264 does not need the persisted credential. `prepareAgentMode` calls `configureGitAuth`/`replaceCheckoutCredentials`, which tolerates a missing header and sets `origin` to the action's own app token from the OIDC exchange. That happens before the only git network call (`restoreConfigFromBase`, which runs `git fetch origin <base>`). The review itself uses `gh` with the action's token.
  - Persisted credentials are still risky on checkout v6+. The action's cleanup reads only `include.path`, while checkout v6+ (checked on v7.0.1) writes `includeIf.gitdir:<gitdir>.path`. So `persist-credentials: false` is the fix that works, not a nice-to-have.
  - The other two workflows only clone the public conventions repo and run `git ls-remote` against it, so neither needs credentials.
- **Repo-owned refs (`"refs": "repo"` in the manifest, on the three workflow entries).**
  - *Normalize.* A `uses: owner/action[/path]@<40-hex> [# comment]` line becomes `uses: owner/action[/path]@<sha>`, and a `node-version:` value becomes `<repo>`. A ref that is not a 40-hex SHA stays literal, so it shows up as drift (SUP-1).
  - *Hashes.* The lock stores `sha(normalize(file))` for these files. The lock format is unchanged, and so is every other file's hash.
  - *OK / drift.* The file is OK when `normalize(current) == normalize(desired)`. A Dependabot bump is never drift.
  - *Unedited since last sync.* The lock hash matches `sha(normalize(current))`. For locks written before 1.7.0, it may instead match `sha(current)` or `sha(current with its refs reset to the template seeds)`. The last case covers a 1.6.3 repo that Dependabot already bumped, because 1.7.0 keeps the 1.6.3 seeds. A 1.6.2 repo whose setup-node ref Dependabot bumped is the one exception: the setup-node seed moved in 1.6.3, so it gets a CONFLICT once, and `--force` fixes it without a downgrade.
  - *Write (UPDATE, `--force`).* Sync writes the template, keeping the repo's ref and version comment for each action. It matches actions by `uses` path and occurrence, and falls back to the repo's last occurrence of that action. It also keeps the repo's `node-version` values in order. An action that is new to the template gets the seed. A repo ref that is not a full SHA is not adopted: the seed is written instead and the action note says so.
  - *CREATE.* A brand-new file gets the template seeds.
- **Seeds.** Template SHAs are seeds only. Bumping a seed changes nothing for a repo that already has the file, so it needs no release-driven `UPDATE`. 1.7.0 keeps the 1.6.3 seeds unchanged. Bumping them is a follow-up patch (Boyce's decision).
- **Docs.** STANDARD gets new SUP-7, and SUP-1, SUP-5 and SUP-6 are rewritten. The dependency-update skill, `global/CLAUDE.md` and the `agents-core` block say: do not pin or cap to satisfy conventions or to avoid work. Pin or set a floor only for a documented major security issue, and declare it in the manifest. The README documents repo-owned refs and release notes. The CHANGELOG gets a 1.7.0 entry.

## Decisions (Boyce)

- Ship `persist-credentials: false` as the replacement for the checkout v4.4.0 hold.
- Bump the seed SHAs in a later patch, in a follow-up PR, not this one.
- Release 1.7.0 after 1.6.3. Aside moves `v1` with a main -> v1 merge PR, the same way as #13.

## Not changed

- The "Fetch pinned conventions" step.
- The lock format.
- Block, seed and json-merge files.
- Any other repo. No tag is created and the `v1` branch is not moved.

## Test plan

Run `node --test test/*.test.mjs` on Node 20 and 22. The tests cover:

- The Dependabot template has no `ignore` rule.
- After a sync, the three workflows' SHAs are bumped. `--check` exits 0, apply writes nothing and does not downgrade, and `--force` keeps the bumped refs.
- A version change in the template (body change) is an UPDATE that keeps bumped refs, adds the template's new actions with seed refs, and keeps the repo's `node-version`.
- Upgrade from a pre-1.7.0 lock (raw hashes): an untouched repo gets UPDATE, and a Dependabot-bumped repo also gets UPDATE (not CONFLICT) with its refs kept. The 1.6.2-with-bumped-setup-node edge case gets a CONFLICT, and one `--force` keeps the refs.
- New-file seeding.
- A hand edit outside the refs is still a CONFLICT.
- Other managed files keep raw hashes and unchanged behavior.
- SHA-form guard: every template `uses:` is a 40-hex SHA with a version comment, and a repo ref like `@v4` is flagged and not adopted.
- Every `actions/checkout` step sets `persist-credentials: false`.
