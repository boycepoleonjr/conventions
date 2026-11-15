// node --test test/*.test.mjs
// CI-7: the synced "AI attribution check" job fails a PR, loudly, when a commit carries AI authorship.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { commitProblems } from "../scripts/ai-attribution.mjs";
import { usesRefs, isSha } from "../scripts/sync.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = "templates/ai-attribution-check.yml";
const DEST = ".github/workflows/ai-attribution-check.yml";
const TEMPLATE = fs.readFileSync(path.join(ROOT, SRC), "utf8");
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
const SCRIPT = fs.readFileSync(path.join(ROOT, "scripts/ai-attribution.mjs"), "utf8");
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

function workflowScript(text = TEMPLATE) {
  const m = text.match(/\n {10}script: \|\n((?: {12}.*\n|\n)+)/);
  assert.ok(m, "the workflow has a script block");
  return m[1].replace(/^ {12}/gm, "");
}
const embedded = (text, name) => text.match(new RegExp(`// BEGIN ${name}\\n([\\s\\S]*?)// END ${name}\\n`))[1];

// A commit shaped like the REST API's pulls.listCommits items.
const commit = (over = {}) => ({
  sha: "a".repeat(40),
  author: { login: "boycepoleonjr" },
  committer: { login: "boycepoleonjr" },
  parents: [{ sha: "b".repeat(40) }],
  ...over,
  commit: {
    message: "feat: add a thing",
    author: { name: "Boyce Poleon, Jr.", email: "17016723+boycepoleonjr@users.noreply.github.com" },
    committer: { name: "Boyce Poleon, Jr.", email: "17016723+boycepoleonjr@users.noreply.github.com" },
    ...(over.commit || {}),
  },
});

// ---- the pure function ------------------------------------------------------------------------------------------------

test("a commit by the owner is fine", () => {
  assert.deepEqual(commitProblems(commit()), []);
  assert.deepEqual(commitProblems(commit({ commit: { message: "fix: x\n\nCo-Authored-By: Alice Example <alice@example.com>" } })), []);
});

test("author or committer email noreply@anthropic.com is flagged", () => {
  const a = commitProblems(commit({ commit: { author: { name: "Someone", email: "noreply@anthropic.com" } } }));
  assert.deepEqual(a, ["author email is noreply@anthropic.com"]);
  const c = commitProblems(commit({ commit: { committer: { name: "Someone", email: "NoReply@Anthropic.com" } } }));
  assert.deepEqual(c, ["committer email is noreply@anthropic.com"]);
});

test("author name Claude is flagged, other names containing it are not", () => {
  assert.deepEqual(commitProblems(commit({ commit: { author: { name: "Claude", email: "x@example.com" } } })), ['author name is "Claude"']);
  assert.deepEqual(commitProblems(commit({ commit: { author: { name: "claude", email: "x@example.com" } } })), ['author name is "Claude"']);
  assert.deepEqual(commitProblems(commit({ commit: { author: { name: "Claude Debussy", email: "x@example.com" } } })), []);
});

test("Co-Authored-By trailers naming Claude or Anthropic are flagged", () => {
  for (const line of ["Co-Authored-By: Claude <noreply@anthropic.com>", "Co-authored-by: Claude Opus 5.5 <x@example.com>", "co-authored-by: Anthropic Bot <x@example.com>", "Co-Authored-By: Agent <noreply@anthropic.com>"]) {
    assert.equal(commitProblems(commit({ commit: { message: `fix: x\n\nBody.\n\n${line}\n` } })).length, 1, line);
  }
  assert.deepEqual(commitProblems(commit({ commit: { message: "fix: x\n\nWe asked Claude about this, Co-Authored-By is not a trailer here" } })), []);
});

test("a Claude-Session trailer is flagged", () => {
  assert.deepEqual(commitProblems(commit({ commit: { message: "fix: x\n\nClaude-Session: https://claude.ai/code/session_01Abc" } })), ["message has a Claude-Session trailer"]);
});

test("every problem on a commit is reported", () => {
  const p = commitProblems(commit({ commit: { author: { name: "Claude", email: "noreply@anthropic.com" }, committer: { name: "Claude", email: "noreply@anthropic.com" }, message: "x\n\nCo-Authored-By: Claude <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01Abc" } }));
  assert.equal(p.length, 5);
});

test("Dependabot commits are ignored", () => {
  assert.deepEqual(commitProblems(commit({ author: { login: "dependabot[bot]" }, commit: { author: { name: "dependabot[bot]", email: "49699333+dependabot[bot]@users.noreply.github.com" }, message: "chore(deps): bump x\n\nCo-Authored-By: Anthropic <x@y.z>" } })), []);
});

test("GitHub merge commits are ignored, a local merge by an AI tool is not", () => {
  const github = commit({ parents: [{ sha: "1" }, { sha: "2" }], committer: { login: "web-flow" }, commit: { message: "Merge branch 'main' into feat", committer: { name: "GitHub", email: "noreply@github.com" }, author: { name: "Claude", email: "noreply@anthropic.com" } } });
  assert.deepEqual(commitProblems(github), []);
  const local = commit({ parents: [{ sha: "1" }, { sha: "2" }], commit: { message: "Merge branch 'main'", author: { name: "Claude", email: "noreply@anthropic.com" } } });
  assert.ok(commitProblems(local).length > 0);
  const single = commit({ parents: [{ sha: "1" }], committer: { login: "web-flow" }, commit: { committer: { name: "GitHub", email: "noreply@github.com" }, author: { name: "Claude", email: "noreply@anthropic.com" } } });
  assert.ok(commitProblems(single).length > 0, "a GitHub-committed commit with one parent (squash, web edit) is still checked");
});

test("a commit with missing fields does not throw", () => {
  assert.deepEqual(commitProblems({ sha: "x" }), []);
  assert.deepEqual(commitProblems({ sha: "x", commit: {} }), []);
});

// ---- the embedded copy and the template contract --------------------------------------------------------------------------

test("the copy in the workflow is the function in scripts/ai-attribution.mjs", () => {
  assert.equal(embedded(workflowScript(), "commitProblems"), embedded(SCRIPT, "commitProblems").replace(/^export /, ""));
});

test("manifest: installed as .github/workflows/ai-attribution-check.yml, a replace file with repo-owned refs", () => {
  const f = MANIFEST.files.find((x) => x.id === "ai-attribution-check");
  assert.deepEqual(f, { id: "ai-attribution-check", src: SRC, dest: DEST, mode: "replace", refs: "repo" });
});

test("workflow: SHA pin, read-only permissions, the PR events, a stable job name", () => {
  const refs = usesRefs(TEMPLATE);
  assert.deepEqual(refs.map((u) => u.action), ["actions/github-script"]);
  for (const u of refs) {
    assert.ok(isSha(u.ref));
    assert.match(u.comment, /^ # v\d+\.\d+\.\d+$/);
  }
  assert.match(TEMPLATE, /^permissions:\n {2}contents: read\n {2}pull-requests: read\n(?!\s+\w)/m);
  const code = TEMPLATE.replace(/^\s*#.*$/gm, "");
  assert.ok(!/:\s*write\b|pull_request_target|secrets\.|actions\/checkout/.test(code), "read-only, no checkout of PR code, no secrets");
  assert.match(TEMPLATE, /^on:\n {2}pull_request:\n {4}types: \[opened, synchronize, reopened\]\npermissions:/m);
  assert.match(TEMPLATE, /^ {2}check:\n(?: {4}#.*\n)* {4}name: AI attribution check\n {4}runs-on: ubuntu-latest\n/m, "the job name is the required-check context");
  assert.ok(!code.includes("${{"));
});

// ---- the script against a fake GitHub ----------------------------------------------------------------------------------------

async function run(commits, prCommits = commits.length) {
  const out = { errors: [], info: [], failed: [], pages: [] };
  const github = {
    rest: { pulls: { listCommits: Symbol("listCommits") } },
    paginate: async (fn, args) => { out.pages.push([fn, args]); return commits; },
  };
  const core = { error: (m) => out.errors.push(m), info: (m) => out.info.push(m), setFailed: (m) => out.failed.push(m) };
  const context = { repo: { owner: "octo", repo: "demo" }, payload: { pull_request: { number: 9, commits: prCommits, base: { ref: "main" }, head: { ref: "feat/x" } } } };
  await new AsyncFunction("github", "context", "core", workflowScript())(github, context, core);
  return { ...out, github };
}
const BAD = commit({ sha: "d".repeat(40), commit: { message: "feat: x\n\nCo-Authored-By: Claude <noreply@anthropic.com>", author: { name: "Claude", email: "noreply@anthropic.com" } } });
const BAD2 = commit({ sha: "e".repeat(40), commit: { message: "fix: y\n\nClaude-Session: https://claude.ai/code/session_01Abc" } });

test("script: clean PR passes without failing the job", async () => {
  const r = await run([commit(), commit({ sha: "c".repeat(40) })]);
  assert.deepEqual(r.failed, []);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.pages[0][1], { owner: "octo", repo: "demo", pull_number: 9, per_page: 100 });
  assert.equal(r.pages[0][0], r.github.rest.pulls.listCommits);
});

test("script: a bad commit fails loudly, naming its SHA, why, and how to fix it", async () => {
  const r = await run([commit(), BAD, BAD2]);
  assert.equal(r.failed.length, 1);
  const msg = r.failed[0];
  assert.match(msg, /AI attribution check failed: 2 commit\(s\)/);
  assert.ok(msg.includes("d".repeat(40)) && msg.includes("e".repeat(40)), "both bad SHAs are named");
  assert.ok(!msg.includes("a".repeat(40)), "the good commit is not named");
  assert.match(msg, /re-push the same changes on a new branch with commits authored by the repo owner \(octo\)/);
  assert.match(msg, /no force push needed/);
  assert.match(msg, /git switch -c <new-branch> origin\/main/);
  assert.match(msg, /git merge --squash origin\/feat\/x/);
  assert.equal(r.errors.length, 2, "one annotation per bad commit");
  assert.ok(r.errors[0].startsWith("d".repeat(40)) && r.errors[0].includes("feat: x") && r.errors[0].includes("Co-Authored-By"));
  assert.ok(r.errors[1].startsWith("e".repeat(40)) && r.errors[1].includes("Claude-Session"));
});

test("script: Dependabot and GitHub merge commits do not fail it", async () => {
  const dep = commit({ sha: "1".repeat(40), author: { login: "dependabot[bot]" }, commit: { message: "chore(deps): bump", author: { name: "dependabot[bot]", email: "49699333+dependabot[bot]@users.noreply.github.com" } } });
  const merge = commit({ sha: "2".repeat(40), parents: [{ sha: "x" }, { sha: "y" }], committer: { login: "web-flow" }, commit: { message: "Merge branch 'main' into feat/x", committer: { name: "GitHub", email: "noreply@github.com" } } });
  const r = await run([dep, merge]);
  assert.deepEqual(r.failed, []);
});

test("script: a commit list shorter than the PR's commit count fails (unchecked is not a pass)", async () => {
  const r = await run([commit()], 300);
  assert.equal(r.failed.length, 1);
  assert.match(r.failed[0], /could not list every commit: got 1 of 300/);
});

// ---- sync installs it --------------------------------------------------------------------------------------------------------

test("a new repo gets the workflow with the version filled in, and --check is clean", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "attrchk-"));
  fs.writeFileSync(path.join(repo, "package.json"), JSON.stringify({ name: "demo-app", scripts: { test: "jest" } }));
  fs.writeFileSync(path.join(repo, "package-lock.json"), "{}");
  fs.writeFileSync(path.join(repo, "tsconfig.json"), "{}");
  const run1 = (args) => spawnSync(process.execPath, [path.join(ROOT, "scripts/sync.mjs"), "--repo", repo, ...args], { encoding: "utf8" });
  assert.equal(run1(["--init"]).status, 0);
  assert.equal(fs.readFileSync(path.join(repo, DEST), "utf8"), TEMPLATE.replace("{{conventions.version}}", fs.readFileSync(path.join(ROOT, "VERSION"), "utf8").trim()));
  assert.equal(run1(["--check"]).status, 0);
});
