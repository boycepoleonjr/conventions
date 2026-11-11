// node --test test/*.test.mjs
// CI-4: the claude-review workflow must fail loudly when it cannot read the full PR diff.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE = fs.readFileSync(path.join(ROOT, "templates/claude-code-review.yml"), "utf8");
const SHA = "a".repeat(40);
const OLD_SHA = "b".repeat(40);

// The template is YAML with {{ }} placeholders; these checks work on its text, so no YAML parser is needed.
const rendered = TEMPLATE.replace("{{conventions.version}}", "0.0.0").replace(/^\{\{claude_review_focus\}\}\n/m, "");

function verifyScript() {
  const m = rendered.match(/- name: Verify the review was complete\n[\s\S]*?\n {8}run: \|\n((?: {10}.*\n|\n)+)/);
  assert.ok(m, "verify step with a run block exists");
  return m[1].replace(/^ {10}/gm, "");
}

test("the summary prompt defines the review-status contract", () => {
  assert.match(rendered, /review-status: complete \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.match(rendered, /review-status: incomplete \$\{\{ github\.event\.pull_request\.head\.sha \}\} <short reason>/);
  assert.match(rendered, /exactly one machine-readable line/);
  assert.match(rendered, /Never write the text `review-status:` anywhere else/);
  assert.match(rendered, /complete only when you read every changed file/);
  assert.match(rendered, /Never present an incomplete review as a clean one/);
});

test("large diffs: a failing gh pr diff falls back to the paginated file list, and gaps make the review incomplete", () => {
  assert.match(rendered, /If `gh pr diff` fails for any reason \(for example HTTP 406[^)]*20,000-line limit\)/);
  assert.match(rendered, /gh api repos\/\$\{\{ github\.repository \}\}\/pulls\/\$\{\{ github\.event\.pull_request\.number \}\}\/files --paginate/);
  assert.match(rendered, /review file by file, using each file's `patch`/);
  assert.match(rendered, /a file has no `patch`/);
  assert.match(rendered, /any `gh` call failed/);
  assert.match(rendered, /any `gh` call failed and was not recovered \(the one failed `gh pr diff` that you replaced with the file-list fallback does not count, but a failure of the fallback itself does\)/);
  assert.match(rendered, /--json changedFiles/);
  assert.match(rendered, /at most 3000 files/);
});

test("allowedTools: the files endpoint is allowed, PR-scoped, and there is no blanket gh api", () => {
  const args = rendered.match(/--allowedTools "([^"]*)"/)[1];
  const tools = args.split(",");
  const files = "Bash(gh api repos/${{ github.repository }}/pulls/${{ github.event.pull_request.number }}/files:*)";
  const comments = "Bash(gh api repos/${{ github.repository }}/pulls/${{ github.event.pull_request.number }}/comments:*)";
  assert.ok(tools.includes(files), "files endpoint allowed");
  assert.ok(tools.includes(comments), "review-comments endpoint still allowed");
  for (const t of tools.filter((x) => x.startsWith("Bash(gh api"))) {
    assert.match(t, /^Bash\(gh api repos\/\$\{\{ github\.repository \}\}\/pulls\/\$\{\{ github\.event\.pull_request\.number \}\}\/(files|comments):\*\)$/);
  }
  assert.ok(!/Bash\(gh api:\*\)/.test(args));
  assert.match(rendered, /\(GET only\)/);
});

test("kept as before: pins, permissions, concurrency, skips", () => {
  // Seeds only (SUP-7): the form is fixed (SUP-1), the version is not.
  assert.match(rendered, /uses: actions\/checkout@[0-9a-f]{40} # v\d+\.\d+\.\d+\n {8}with:\n {10}fetch-depth: 1\n {10}persist-credentials: false\n/);
  assert.match(rendered, /uses: anthropics\/claude-code-action@[0-9a-f]{40} # v1\.\d+\.\d+\n/);
  assert.match(rendered, /^permissions: \{\}$/m);
  assert.match(rendered, /^ {4}permissions:\n {6}contents: read\n {6}pull-requests: read\n {6}issues: read\n {6}id-token: write\n/m);
  assert.match(rendered, /concurrency:\n {2}group: claude-review-\$\{\{ github\.event\.pull_request\.number \}\}\n {2}cancel-in-progress: true/);
  assert.match(rendered, /github\.event\.pull_request\.draft == false/);
  assert.match(rendered, /head\.repo\.full_name == github\.repository/);
  assert.match(rendered, /dependabot\[bot\].*github-actions\[bot\].*renovate\[bot\]/);
  assert.match(rendered, /skipped job, not a failure/);
  assert.match(rendered, /durable-agent treats a skipped required check as blocking/);
});

test("the verify step comes after the action, is unconditional, and only reads", () => {
  const iAction = rendered.indexOf("claude-code-action@");
  const iVerify = rendered.indexOf("- name: Verify the review was complete");
  assert.ok(iAction > 0 && iVerify > iAction, "verify runs after the review action");
  const step = rendered.slice(iVerify);
  assert.ok(!/^ {8}if:/m.test(step), "no if: that could skip it");
  assert.ok(!/continue-on-error/.test(step));
  assert.match(step, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  const script = verifyScript();
  assert.match(script, /^set -euo pipefail$/m);
  assert.match(script, /gh api "repos\/\$REPO\/issues\/\$PR_NUMBER\/comments" --paginate/);
  // One GET of the PR comments for every PR, plus (self-edit PRs only, inside the waiver branch) one GET of a commenter's permission.
  const calls = script.match(/\bgh api [^\n]*/g) || [];
  assert.equal(calls.length, 2, "exactly two gh calls");
  assert.equal(script.match(/\bgh\b/g).length, 2);
  assert.match(calls[0], /^gh api "repos\/\$REPO\/issues\/\$PR_NUMBER\/comments" --paginate\)?/);
  assert.match(calls[1], /^gh api "repos\/\$REPO\/collaborators\/\$login\/permission" --jq \.permission\)/);
  assert.ok(script.indexOf(calls[1]) > script.indexOf('if [ "${SELF_EDIT:-false}" = "true" ]; then') && script.indexOf(calls[1]) < script.indexOf("# Newest bot comment"), "the permission lookup is only reachable on self-edit PRs");
  assert.ok(!/(-X|--method|\s-f\b|\s-F\b|--field|--input)/.test(script.replace(/-sr|-ne/g, "")), "no write flags");
  assert.ok(!/gh (pr comment|pr review|issue)/.test(script));
  assert.match(script, /exit 1/);
  assert.match(script, /::error::/);
});

// Run the real verify script against a fake `gh` that serves canned comment pages and, for the self-edit branch,
// `repos/o/r/collaborators/<login>/permission` answers from `perms` ({ login: "admin" | "write" | ... }); a login that is
// not in `perms` makes the lookup fail with HTTP 404, like a real error would.
function runVerify(pages, { ghFails = false, env = {}, perms = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "verify-"));
  fs.mkdirSync(path.join(dir, "bin"));
  fs.mkdirSync(path.join(dir, "perms"));
  for (const [login, perm] of Object.entries(perms)) fs.writeFileSync(path.join(dir, "perms", login), `${perm}\n`);
  fs.writeFileSync(path.join(dir, "comments.json"), pages.map((p) => JSON.stringify(p)).join("\n"));
  fs.writeFileSync(path.join(dir, "gh-args"), "");
  fs.writeFileSync(
    path.join(dir, "bin/gh"),
    `#!/bin/bash
echo "$@" >> "${dir}/gh-args"
case "$2" in
  */collaborators/*/permission)
    login="\${2#*collaborators/}"; login="\${login%/permission}"
    if [ -f "${dir}/perms/$login" ]; then cat "${dir}/perms/$login"; else echo 'HTTP 404' >&2; exit 1; fi ;;
  *) ${ghFails ? "echo 'HTTP 500' >&2; exit 1" : `cat "${dir}/comments.json"`} ;;
esac
`,
    { mode: 0o755 },
  );
  fs.writeFileSync(path.join(dir, "verify.sh"), verifyScript());
  const r = spawnSync("bash", [path.join(dir, "verify.sh")], {
    encoding: "utf8",
    env: { PATH: `${dir}/bin:${process.env.PATH}`, GH_TOKEN: "x", REPO: "o/r", PR_NUMBER: "7", HEAD_SHA: SHA, ...env },
  });
  return { code: r.status, out: r.stdout + r.stderr, args: fs.readFileSync(path.join(dir, "gh-args"), "utf8") };
}
const bot = (body, created_at, id = 1) => ({ id, created_at, body, user: { type: "Bot", login: "claude[bot]" } });
const human = (body, created_at, id = 2) => ({ id, created_at, body, user: { type: "User", login: "someone" } });
const summary = (line, sha = SHA) => `Re-review of ${sha}.\n\nNo new issues found.\n\n${line}\n`;

test("verify passes only for review-status: complete <HEAD_SHA>", () => {
  const r = runVerify([[bot(summary(`review-status: complete ${SHA}`), "2026-11-01T10:00:00Z")]]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Review complete/);
  assert.match(r.args, /^api repos\/o\/r\/issues\/7\/comments --paginate$/m, "GET of this PR's issue comments only");
});

test("verify fails on an incomplete review and shows the reason", () => {
  const r = runVerify([[bot(summary(`review-status: incomplete ${SHA} gh pr diff returned HTTP 406, 3 files had no patch`), "2026-11-01T10:00:00Z")]]);
  assert.equal(r.code, 1);
  assert.match(r.out, /::error::.*not complete: review-status: incomplete .* HTTP 406/);
});

test("verify fails when no comment names the head SHA (missing or only a stale SHA)", () => {
  for (const pages of [[[]], [], [[bot(summary(`review-status: complete ${OLD_SHA}`, OLD_SHA), "2026-11-01T10:00:00Z")]]]) {
    const r = runVerify(pages);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /::error::No Claude review summary with a review-status line names head commit/);
  }
});

test("verify fails when the summary has no status line, two lines, or a malformed line", () => {
  const cases = [
    summary(""),
    `${summary(`review-status: complete ${SHA}`)}review-status: complete ${SHA}\n`,
    `${summary(`review-status: complete ${SHA}`)}review-status: incomplete ${SHA} x\n`,
    summary(`review-status: complete ${SHA} but not really`),
    summary(`review-status: Complete ${SHA}`),
    summary(`review-status: complete ${OLD_SHA}`).replace(OLD_SHA, OLD_SHA) + `Head ${SHA}\n`,
    summary(`**review-status: complete ${SHA}**`),
    summary(`\`review-status: complete ${SHA}\``),
  ];
  for (const body of cases) {
    const r = runVerify([[bot(body, "2026-11-01T10:00:00Z")]]);
    assert.equal(r.code, 1, `must fail:\n${body}\n${r.out}`);
    assert.match(r.out, /::error::/);
  }
});

test("verify uses the newest summary that names the SHA, across pages", () => {
  const complete = bot(summary(`review-status: complete ${SHA}`), "2026-11-01T10:00:00Z", 1);
  const incomplete = bot(summary(`review-status: incomplete ${SHA} fetch error`), "2026-11-01T11:00:00Z", 3);
  assert.equal(runVerify([[incomplete], [complete]]).code, 1, "newest (incomplete) wins even on an earlier page");
  assert.equal(runVerify([[complete], [incomplete]]).code, 1);
  const rerun = bot(summary(`review-status: complete ${SHA}`), "2026-11-01T12:00:00Z", 4);
  assert.equal(runVerify([[incomplete], [rerun]]).code, 0, "a later complete re-review passes");
});

test("verify ignores human comments, so a typed status line cannot satisfy the check", () => {
  const r = runVerify([[human(summary(`review-status: complete ${SHA}`), "2026-11-01T10:00:00Z")]]);
  assert.equal(r.code, 1);
  assert.match(r.out, /No Claude review summary with a review-status line/);
  const mixed = runVerify([[bot(summary(`review-status: incomplete ${SHA} x`), "2026-11-01T10:00:00Z", 1), human(summary(`review-status: complete ${SHA}`), "2026-11-01T11:00:00Z")]]);
  assert.equal(mixed.code, 1, "a newer human comment does not override the bot summary");
});

test("verify fails loudly when the comments cannot be fetched", () => {
  const r = runVerify([], { ghFails: true });
  assert.equal(r.code, 1);
  assert.match(r.out, /::error::Could not list the PR comments/);
});

test("verify ignores unrelated bot comments that name the SHA, before or after the summary", () => {
  const complete = bot(summary(`review-status: complete ${SHA}`), "2026-11-01T10:00:00Z", 1);
  const deploy = bot(`Preview ready for ${SHA}`, "2026-11-01T11:00:00Z", 5);
  assert.equal(runVerify([[complete, deploy]]).code, 0, "a later deploy-bot comment must not hide a complete summary");
  const incomplete = bot(summary(`review-status: incomplete ${SHA} fetch error`), "2026-11-01T10:00:00Z", 1);
  assert.equal(runVerify([[incomplete, deploy]]).code, 1, "and must not hide an incomplete one");
  const only = runVerify([[deploy]]);
  assert.equal(only.code, 1, "a SHA mention with no status line is not a summary");
  assert.match(only.out, /No Claude review summary with a review-status line/);
});

// ---------------------------------------------------------------------------------------------------------------------
// 1.7.1: a PR that edits this workflow cannot be reviewed by claude-code-action (it refuses to run when the PR's copy
// differs from the default branch). The check must still never be green for a review that did not happen: it passes
// only on an explicit waiver from the repository owner for the current head SHA.
// ---------------------------------------------------------------------------------------------------------------------
const WF_PATH = ".github/workflows/claude-code-review.yml";

function stepScript(name) {
  const i = rendered.indexOf(`- name: ${name}\n`);
  assert.ok(i >= 0, `step ${name} exists`);
  const m = rendered.slice(i).match(/\n {8}run: \|\n((?: {10}.*\n|\n)+)/);
  assert.ok(m, `${name} has a run block`);
  return m[1].replace(/^ {10}/gm, "");
}

// Runs the real "Detect self-edit" script against a fake `gh` that applies the --jq filter (with the real jq) to each
// canned page, the way `gh api --paginate --jq` does.
function runDetect(pages, { ghFails = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "detect-"));
  fs.mkdirSync(path.join(dir, "bin"));
  fs.writeFileSync(path.join(dir, "files.json"), pages.map((p) => JSON.stringify(p)).join("\n"));
  fs.writeFileSync(path.join(dir, "gh-args"), "");
  fs.writeFileSync(path.join(dir, "output"), "");
  fs.writeFileSync(
    path.join(dir, "bin/gh"),
    `#!/bin/bash
echo "$@" >> "${dir}/gh-args"
${ghFails ? "echo 'HTTP 502' >&2; exit 1" : `filter=""
while [ $# -gt 0 ]; do if [ "$1" = "--jq" ]; then filter="$2"; fi; shift; done
jq -r "$filter" "${dir}/files.json"`}
`,
    { mode: 0o755 },
  );
  fs.writeFileSync(path.join(dir, "detect.sh"), stepScript("Detect self-edit"));
  const r = spawnSync("bash", [path.join(dir, "detect.sh")], {
    encoding: "utf8",
    env: { PATH: `${dir}/bin:${process.env.PATH}`, GH_TOKEN: "x", REPO: "o/r", PR_NUMBER: "7", GITHUB_OUTPUT: path.join(dir, "output") },
  });
  return { code: r.status, out: r.stdout + r.stderr, output: fs.readFileSync(path.join(dir, "output"), "utf8"), args: fs.readFileSync(path.join(dir, "gh-args"), "utf8") };
}
const file = (filename, extra = {}) => ({ filename, status: "modified", ...extra });

test("self-edit: Detect self-edit is the first step, read-only, and decides whether the review action runs", () => {
  const firstStep = rendered.match(/\n {4}steps:\n {6}(?:#.*\n {6})*- name: (.*)\n/);
  assert.equal(firstStep[1], "Detect self-edit");
  const s = rendered.slice(rendered.indexOf("- name: Detect self-edit"), rendered.indexOf("- name: Require CLAUDE_CODE_OAUTH_TOKEN"));
  assert.match(s, /id: self_edit/);
  assert.match(s, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.ok(!/^ {8}if:/m.test(s) && !/continue-on-error/.test(s), "cannot be skipped or ignored");
  const script = stepScript("Detect self-edit");
  assert.match(script, /^set -euo pipefail$/m);
  assert.match(script, /gh api "repos\/\$REPO\/pulls\/\$PR_NUMBER\/files" --paginate --jq /);
  assert.equal((script.match(/\bgh\b/g) || []).length, 1, "exactly one gh call");
  assert.ok(!/(-X|--method|\s-f\b|\s-F\b|--field|--input)/.test(script.replace(/-Fxq/, "")), "GET only");
  // The review action is skipped on self-edit PRs; every other step is not conditional on it.
  const run = rendered.slice(rendered.indexOf("- name: Run Claude Code Review"), rendered.indexOf("- name: Verify the review was complete"));
  assert.match(run, /^ {8}if: steps\.self_edit\.outputs\.self_edit != 'true'$/m);
  assert.equal((rendered.match(/self_edit != 'true'/g) || []).length, 1, "only the review action is skipped");
  assert.match(rendered.slice(rendered.indexOf("- name: Verify the review was complete")), /SELF_EDIT: \$\{\{ steps\.self_edit\.outputs\.self_edit \}\}/);
});

test("self-edit detection: the PR file list names the workflow (also as the old name of a rename) -> true", () => {
  const hit = runDetect([[file("README.md"), file(WF_PATH)]]);
  assert.equal(hit.code, 0, hit.out);
  assert.match(hit.output, /^self_edit=true$/m);
  assert.match(hit.args, /^api repos\/o\/r\/pulls\/7\/files --paginate --jq /m, "GET of this PR's files only");
  const second = runDetect([[file("a.md")], [file("b.md"), file(WF_PATH, { status: "removed" })]]);
  assert.match(second.output, /^self_edit=true$/m, "found on a later page");
  const renamed = runDetect([[file("docs/renamed.yml", { status: "renamed", previous_filename: WF_PATH })]]);
  assert.match(renamed.output, /^self_edit=true$/m, "renaming the workflow away also changes it");
});

test("self-edit detection: other files, look-alike paths and an empty list -> false", () => {
  for (const pages of [
    [[file("src/index.ts"), file(".github/workflows/ci.yml")]],
    [[file(`docs/${WF_PATH}`), file(`${WF_PATH}.bak`), file(".github/workflows/claude-code-review.yaml"), file("claude-code-review.yml")]],
    [[]],
  ]) {
    const r = runDetect(pages);
    assert.equal(r.code, 0, r.out);
    assert.match(r.output, /^self_edit=false$/m);
    assert.doesNotMatch(r.output, /self_edit=true/);
  }
});

test("self-edit detection: a failing files endpoint fails the job loudly and sets no output", () => {
  const r = runDetect([], { ghFails: true });
  assert.equal(r.code, 1);
  assert.match(r.out, /::error::Could not list the files of this PR/);
  assert.equal(r.output, "", "no self_edit output, so nothing downstream can mistake it for false");
});

// A comment by a human. `assoc` is GitHub's author_association for that user on the repository.
const human2 = (login, assoc, body, created_at = "2026-11-04T10:00:00Z", id = 11) => ({ id, created_at, body, author_association: assoc, user: { type: "User", login } });
const owner = (body, created_at, id) => human2("boyce", "OWNER", body, created_at, id);
const SELF = { env: { SELF_EDIT: "true" } };
const waiver = (sha = SHA) => `review-waiver: ${sha}`;
const lookups = (r) => r.args.split("\n").filter((l) => l.includes("/collaborators/"));
const NO_WAIVER_ERROR = /::error::This PR edits \.github\/workflows\/claude-code-review\.yml, so Claude cannot review it/;

test("self-edit verify: a user-owned repo's OWNER waiver for the head SHA passes without any permission lookup, and says no review ran", () => {
  const r = runVerify([[owner(`Independent review done.\n\n${waiver()}\n`)]], SELF);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /::warning::No Claude review ran: this PR edits the review workflow\. boyce waived it for a{40}/);
  assert.doesNotMatch(r.out, /Review complete/, "must not claim a review happened");
  assert.equal(r.args.trim(), "api repos/o/r/issues/7/comments --paginate", "one GET of this PR's issue comments, no permission lookup");
  assert.equal(runVerify([[owner(`${waiver()}\r\n`)]], SELF).code, 0, "CRLF line endings are fine");
  assert.equal(runVerify([[owner("x", "2026-11-04T09:00:00Z", 9)], [owner(waiver(), "2026-11-04T10:00:00Z", 10)]], SELF).code, 0, "found on a later page");
});

test("self-edit verify: an org MEMBER with admin permission passes (the owner's comment is MEMBER in an org repo)", () => {
  const r = runVerify([[human2("orgowner", "MEMBER", waiver())]], { ...SELF, perms: { orgowner: "admin" } });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /::warning::No Claude review ran: this PR edits the review workflow\. orgowner waived it for a{40}/);
  assert.deepEqual(lookups(r), ["api repos/o/r/collaborators/orgowner/permission --jq .permission"], "one GET of that commenter's permission");
  // Other associations that can hold admin: an outside collaborator, a CONTRIBUTOR-labelled account, no association at all.
  for (const assoc of ["COLLABORATOR", "CONTRIBUTOR", "NONE"]) {
    assert.equal(runVerify([[human2("someadmin", assoc, waiver())]], { ...SELF, perms: { someadmin: "admin" } }).code, 0, `${assoc} with admin passes`);
  }
});

test("self-edit verify: a MEMBER (or anyone) without admin permission fails, whatever the lower permission is", () => {
  for (const perm of ["write", "maintain", "triage", "read", "none", "", "ADMIN", "administrator"]) {
    const r = runVerify([[human2("dev", "MEMBER", waiver())]], { ...SELF, perms: { dev: perm } });
    assert.equal(r.code, 1, `permission "${perm}" must not waive\n${r.out}`);
    assert.match(r.out, NO_WAIVER_ERROR);
    assert.equal(lookups(r).length, 1);
  }
  for (const assoc of ["MEMBER", "COLLABORATOR", "CONTRIBUTOR", "FIRST_TIME_CONTRIBUTOR", "NONE"]) {
    assert.equal(runVerify([[human2("dev", assoc, waiver())]], { ...SELF, perms: { dev: "write" } }).code, 1, `${assoc} with write must not waive`);
  }
});

test("self-edit verify: a failing permission lookup fails loudly, even for a commenter who might have been an admin", () => {
  const r = runVerify([[human2("orgowner", "MEMBER", waiver())]], SELF); // no perms entry: the fake gh answers HTTP 404
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /::error::Could not look up the permission of orgowner on o\/r to check their review-waiver\. Re-run the job\./);
  assert.doesNotMatch(r.out, /waived/);
  // A lookup that fails for one commenter is not skipped in favour of a later one.
  const two = runVerify([[human2("a-first", "MEMBER", waiver(), "2026-11-04T10:00:00Z", 1), human2("b-second", "MEMBER", waiver(), "2026-11-04T11:00:00Z", 2)]], { ...SELF, perms: { "b-second": "admin" } });
  assert.equal(two.code, 1, two.out);
  assert.match(two.out, /Could not look up the permission of a-first/);
});

test("self-edit verify: no waiver fails with the specific message", () => {
  for (const pages of [[[]], [], [[owner("Looks fine to me.")]], [[human2("orgowner", "MEMBER", "Looks fine to me.")]]]) {
    const r = runVerify(pages, { ...SELF, perms: { orgowner: "admin" } });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, NO_WAIVER_ERROR);
    assert.match(r.out, /An independent review is required/);
    assert.match(r.out, /a repository admin \(the owner\) must comment a line exactly 'review-waiver: a{40}' on this PR/);
    assert.equal(lookups(r).length, 0, "only commenters who wrote the exact waiver line are looked up");
  }
});

test("self-edit verify: a waiver for an older head SHA does not count, for owners and admins alike", () => {
  const r = runVerify([[owner(waiver(OLD_SHA))]], SELF);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /review-waiver: a{40}'/, "the message asks for the current SHA");
  assert.equal(runVerify([[owner(`${waiver(OLD_SHA)}\n${waiver(SHA.slice(0, 39))}\n${waiver(SHA + "0")}`)]], SELF).code, 1, "a prefix or longer SHA is not the head SHA");
  const admin = runVerify([[human2("orgowner", "MEMBER", waiver(OLD_SHA))]], { ...SELF, perms: { orgowner: "admin" } });
  assert.equal(admin.code, 1, "a stale waiver from an admin fails");
  assert.equal(lookups(admin).length, 0);
});

test("self-edit verify: a bot never waives, even with OWNER association or admin permission", () => {
  const bots = [
    { ...owner(waiver()), user: { type: "Bot", login: "claude[bot]" } },
    { ...owner(waiver()), author_association: "NONE", user: { type: "Bot", login: "claude[bot]" } },
    { ...owner(waiver()), user: { type: "Bot", login: "boyce-agent[bot]" } },
    { ...owner(waiver()), user: { type: "Organization", login: "some-org" } },
  ];
  for (const b of bots) {
    const r = runVerify([[b]], { ...SELF, perms: { "claude[bot]": "admin", "boyce-agent[bot]": "admin", "some-org": "admin" } });
    assert.equal(r.code, 1, "a bot must not waive");
    assert.equal(lookups(r).length, 0, "no permission lookup for a non-human");
  }
  const mixed = runVerify([[human2("dev", "MEMBER", waiver()), bot(`${waiver()}\n`, "2026-11-04T11:00:00Z", 12)]], { ...SELF, perms: { dev: "write" } });
  assert.equal(mixed.code, 1);
});

test("self-edit verify: one admin among several commenters is enough; a user who is not admin does not block it", () => {
  const r = runVerify([[human2("dev", "MEMBER", waiver(), "2026-11-04T10:00:00Z", 1), human2("orgowner", "MEMBER", waiver(), "2026-11-04T11:00:00Z", 2)]], { ...SELF, perms: { dev: "write", orgowner: "admin" } });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /orgowner waived it/);
});

test("self-edit verify: the waiver must be a line of its own, exactly", () => {
  for (const body of [
    `please do review-waiver: ${SHA}`,
    `> review-waiver: ${SHA}`,
    `\`review-waiver: ${SHA}\``,
    `**review-waiver: ${SHA}**`,
    ` review-waiver: ${SHA}`,
    `review-waiver:${SHA}`,
    `Review-Waiver: ${SHA}`,
    `review-waiver: ${SHA} (maybe)`,
    `review-waiver: ${SHA.toUpperCase()}`,
  ]) {
    assert.equal(runVerify([[owner(body)]], SELF).code, 1, `owner: must fail: ${body}`);
    const admin = runVerify([[human2("orgowner", "MEMBER", body)]], { ...SELF, perms: { orgowner: "admin" } });
    assert.equal(admin.code, 1, `admin: must fail: ${body}`);
    assert.equal(lookups(admin).length, 0);
  }
});

test("self-edit verify: a login that is not a plain GitHub login is never put into the lookup path", () => {
  const r = runVerify([[human2("../orgs/x", "MEMBER", waiver())]], { ...SELF, perms: {} });
  assert.equal(r.code, 1);
  assert.match(r.out, NO_WAIVER_ERROR);
  assert.equal(lookups(r).length, 0);
});

test("self-edit verify: a complete Claude summary, or any non-waiver comment, cannot stand in for the waiver", () => {
  const r = runVerify([[bot(summary(`review-status: complete ${SHA}`), "2026-11-04T10:00:00Z")]], SELF);
  assert.equal(r.code, 1, "on a self-edit PR only the waiver passes");
  assert.match(r.out, /::error::This PR edits/);
});

test("self-edit verify: a failing comments endpoint still fails loudly", () => {
  const r = runVerify([], { ghFails: true, env: SELF.env });
  assert.equal(r.code, 1);
  assert.match(r.out, /::error::Could not list the PR comments/);
});

test("normal PRs behave as before: an owner waiver is ignored, and every v1.7.0 case still decides on the review summary", () => {
  for (const env of [{}, { SELF_EDIT: "false" }, { SELF_EDIT: "" }]) {
    const w = runVerify([[owner(waiver()), human2("orgowner", "MEMBER", waiver(), "2026-11-04T11:00:00Z", 12)]], { env, perms: { orgowner: "admin" } });
    assert.equal(w.code, 1, "a waiver does not replace a review on a normal PR");
    assert.equal(lookups(w).length, 0, "and a normal PR never looks up permissions");
    assert.match(w.out, /::error::No Claude review summary with a review-status line names head commit/);
    assert.equal(runVerify([[bot(summary(`review-status: complete ${SHA}`), "2026-11-04T10:00:00Z")]], { env }).code, 0, "complete passes");
    assert.equal(runVerify([[bot(summary(`review-status: incomplete ${SHA} x`), "2026-11-04T10:00:00Z")]], { env }).code, 1, "incomplete fails");
    assert.equal(runVerify([[]], { env }).code, 1, "missing fails");
    assert.equal(runVerify([[bot(`${summary(`review-status: complete ${SHA}`)}review-status: complete ${SHA}\n`, "2026-11-04T10:00:00Z")]], { env }).code, 1, "duplicate fails");
    assert.equal(runVerify([[bot(summary(`**review-status: complete ${SHA}**`), "2026-11-04T10:00:00Z")]], { env }).code, 1, "malformed fails");
    assert.equal(runVerify([[human(summary(`review-status: complete ${SHA}`), "2026-11-04T10:00:00Z")]], { env }).code, 1, "human spoof fails");
  }
});
