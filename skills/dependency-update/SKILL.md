---
name: dependency-update
description: Use when updating dependencies or clearing npm/pip audit findings. Prefers the smallest safe change and declares every version change openly.
---

# Dependency update

1. Record the audit before: counts by severity, using the exact command from CI.
2. Try non-breaking fixes first: `npm audit fix` (or the ecosystem equivalent), patch and minor bumps.
3. Major bumps of direct dependencies only when required to pass the gate. Explain each one in the PR.
4. Declare changes openly in the manifest. If you must downgrade or pin a package, change its declared range in `package.json` (or equivalent) so the manifest tells the truth. Use `overrides`/`resolutions` only for transitive packages you cannot reach otherwise, and explain each override in the PR.
5. Regenerate the lockfile with the repo's own package manager. Never add a second lockfile.
6. Verify with a clean install, the audit command, lint, typecheck, tests and build. Report the audit after, and list every version change.
