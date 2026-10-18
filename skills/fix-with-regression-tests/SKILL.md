---
name: fix-with-regression-tests
description: Use when fixing a bug or a review finding. Ensures the fix ships with regression tests that cover every path of the change, not just the reported repro.
---

# Fix with regression tests

1. Reproduce the bug in a failing test first.
2. List every path your fix touches: empty input, invalid input, valid input, boundary values, and every guard or early return you add.
3. Write one assertion per path. A guard you add (for example "submit requires a valid contact") needs its own test that tries to bypass it.
4. Keep the diff minimal. If jsdom or the test runner lacks an API (for example `scrollIntoView`), mock it inside the test and restore it after.
5. Run the full suite, not only the new tests. Report each path covered in the PR description.

Example (from a real review): a nav button opened a consent modal without validating the contact field. Paths tested: empty contact keeps the modal closed and shows the error; invalid contact does the same; valid contact opens the modal; clearing the field after opening still blocks submit.
