---
name: open-pr
description: Use before opening or marking ready any pull request. Runs the repo's checks, writes the PR description from the template, and decides draft vs ready.
---

# Open a PR

1. Confirm the branch is `<type>/<slug>` off the right base, and the diff contains only this task's changes.
2. Run every command in the Commands block of `AGENTS.md`. Record the real exit code of each. Fix failures you caused; note pre-existing failures with evidence (the same check failing on the base branch).
3. Open the PR as a **draft** after the first commit.
4. Fill `.github/pull_request_template.md`: what, why, the checks table with real results, risk, and decisions needed.
5. Mark it **ready for review** only when every command passes and CI is green. Never merge.
6. Write or update `docs/handoffs/YYYY-MM-DD-<topic>.md` if the work spans sessions.
