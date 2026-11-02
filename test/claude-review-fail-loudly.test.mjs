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
  assert.match(rendered, /actions\/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4\.4\.0/);
  assert.match(rendered, /claude-code-action@5eb090f3c3afd701a0672cd32981197ca27688f6 # v1\.0\.253/);
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
  assert.equal((script.match(/\bgh\b/g) || []).length, 1, "exactly one gh call");
  assert.ok(!/(-X|--method|\s-f\b|\s-F\b|--field|--input)/.test(script.replace(/-sr|-ne/g, "")), "no write flags");
  assert.ok(!/gh (pr comment|pr review|issue)/.test(script));
  assert.match(script, /exit 1/);
  assert.match(script, /::error::/);
});

// Run the real verify script against a fake `gh` that serves canned comment pages.
function runVerify(pages, { ghFails = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "verify-"));
  fs.mkdirSync(path.join(dir, "bin"));
  fs.writeFileSync(path.join(dir, "comments.json"), pages.map((p) => JSON.stringify(p)).join("\n"));
  fs.writeFileSync(path.join(dir, "gh-args"), "");
  fs.writeFileSync(
    path.join(dir, "bin/gh"),
    `#!/bin/bash\necho "$@" >> "${dir}/gh-args"\n${ghFails ? "echo 'HTTP 500' >&2; exit 1" : `cat "${dir}/comments.json"`}\n`,
    { mode: 0o755 },
  );
  fs.writeFileSync(path.join(dir, "verify.sh"), verifyScript());
  const r = spawnSync("bash", [path.join(dir, "verify.sh")], {
    encoding: "utf8",
    env: { PATH: `${dir}/bin:${process.env.PATH}`, GH_TOKEN: "x", REPO: "o/r", PR_NUMBER: "7", HEAD_SHA: SHA },
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
