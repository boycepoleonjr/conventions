// node --test test/*.test.mjs
// CI-6: the synced conventions-sync-check workflow fails a PR when a managed file was edited by hand (CONFLICT),
// treats "behind the pinned/latest release" as a notice, never fails on a repo-owned ref bump, and fails loudly on a
// clone or network failure.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { usesRefs, isSha } from "../scripts/sync.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = "templates/conventions-sync-check.yml";
const DEST = ".github/workflows/conventions-sync-check.yml";
const TEMPLATE = fs.readFileSync(path.join(ROOT, SRC), "utf8");
const rendered = TEMPLATE.replace("{{conventions.version}}", "0.0.0");
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const write = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const readF = (dir, rel) => fs.readFileSync(path.join(dir, rel), "utf8");
const sync = (repo, args = [], root = ROOT) => {
  const r = spawnSync(process.execPath, [path.join(root, "scripts/sync.mjs"), "--repo", repo, ...args], { encoding: "utf8" });
  return { code: r.status, out: r.stdout + r.stderr };
};
function nodeRepo() {
  const repo = tmp("sc-repo-");
  write(repo, "package.json", JSON.stringify({ name: "demo-app", scripts: { lint: "eslint .", test: "jest", build: "next build" } }));
  write(repo, "package-lock.json", "{}");
  write(repo, "tsconfig.json", "{}");
  return repo;
}
function syncedRepo() {
  const repo = nodeRepo();
  assert.equal(sync(repo, ["--init"]).code, 0);
  assert.equal(sync(repo, ["--check"]).code, 0);
  return repo;
}
// A copy of this checkout at <tmp>/conventions, like the clone the Fetch step makes in $RUNNER_TEMP.
// A real directory, not a symlink: sync.mjs only runs as main when process.argv[1] is its real path.
function copyConventions(version) {
  const dir = path.join(tmp("sc-conv-"), "conventions");
  fs.cpSync(ROOT, dir, { recursive: true, filter: (s) => !s.includes(`${path.sep}.git`) });
  if (version) write(dir, "VERSION", `${version}\n`);
  return dir;
}
let cached;
const clone = () => (cached ||= copyConventions());

// The text of a step's run block, unindented.
function stepScript(name) {
  const i = rendered.indexOf(`- name: ${name}\n`);
  assert.ok(i >= 0, `step ${name} exists`);
  const m = rendered.slice(i).match(/\n {8}run: \|\n((?: {10}.*\n|\n)+)/);
  assert.ok(m, `${name} has a run block`);
  return m[1].replace(/^ {10}/gm, "");
}

// Runs the real "Check managed files" script in `repo`, with `conventions` as the clone the previous step made.
function runCheck(repo, conventions) {
  const runner = conventions ? path.dirname(conventions) : tmp("sc-runner-");
  const script = path.join(runner, "check.sh");
  fs.writeFileSync(script, stepScript("Check managed files"));
  // GitHub runs `bash -e {0}` by default; the script must not rely on more than that.
  const r = spawnSync("bash", ["-e", script], { cwd: repo, encoding: "utf8", env: { PATH: process.env.PATH, RUNNER_TEMP: runner } });
  return { code: r.status, out: r.stdout + r.stderr };
}

// A stand-in for the cloned conventions repo whose sync.mjs prints canned output.
function fakeConventions(body) {
  const dir = path.join(tmp("sc-fake-"), "conventions");
  write(dir, "scripts/sync.mjs", body);
  return dir;
}
const fakeSync = (lines, code) => fakeConventions(`console.log(${JSON.stringify(lines.join("\n"))});\nprocess.exit(${code});\n`);

// What Dependabot does: new SHA and version comment for one action, every occurrence.
function bump(text) {
  return text
    .replace(/(uses: actions\/checkout)@[0-9a-f]{40} # \S+/g, `$1@${"c".repeat(40)} # v7.0.1`)
    .replace(/(uses: actions\/setup-node)@[0-9a-f]{40} # \S+/g, `$1@${"d".repeat(40)} # v6.1.0`)
    .replace(/(uses: anthropics\/claude-code-action)@[0-9a-f]{40} # \S+/g, `$1@${"e".repeat(40)} # v1.0.300`);
}
const WORKFLOWS = MANIFEST.files.filter((f) => f.refs === "repo").map((f) => f.dest);

// ---- template contract ------------------------------------------------------------------------------------------------

test("manifest: sync-check is a replace file with repo-owned refs, like deploy-secrets-lint", () => {
  const f = MANIFEST.files.find((x) => x.id === "sync-check");
  assert.deepEqual(f, { id: "sync-check", src: SRC, dest: DEST, mode: "replace", refs: "repo" });
  const d = MANIFEST.files.find((x) => x.id === "deploy-secrets-lint");
  assert.equal(f.mode, d.mode);
  assert.equal(f.refs, d.refs);
});

test("template: SHA pins with version comments, persist-credentials false, read-only permissions, PR and main triggers", () => {
  assert.match(TEMPLATE, /^# Synced from boycepoleonjr\/conventions v\{\{conventions\.version\}\} \(CI-6\)\./m);
  const refs = usesRefs(TEMPLATE);
  assert.deepEqual(refs.map((u) => u.action), ["actions/checkout", "actions/setup-node"]);
  for (const u of refs) {
    assert.ok(isSha(u.ref), `${u.action} pinned by full SHA`);
    assert.match(u.comment, /^ # v\d+\.\d+\.\d+$/, `${u.action} has a version comment`);
  }
  assert.equal(TEMPLATE.split("\n").filter((l) => /^\s*(-\s+)?uses:/.test(l)).length, refs.length, "every uses: line is a recognized ref");
  assert.match(TEMPLATE, /uses: actions\/checkout@[0-9a-f]{40} # v\d+\.\d+\.\d+\n {8}with:\n {10}persist-credentials: false\n/);
  assert.match(TEMPLATE, /^permissions:\n {2}contents: read\n(?!\s+\w)/m, "workflow permissions: contents read and nothing else");
  assert.ok(!/^ {4}permissions:/m.test(TEMPLATE), "no job-level widening");
  assert.match(TEMPLATE, /^on:\n {2}pull_request:\n {2}push:\n {4}branches: \[main\]\n/m);
  assert.ok(!/pull_request_target|secrets\.|workflow_run|id-token|:\s*write\b/.test(TEMPLATE.replace(/^#.*$/gm, "")), "no secrets, no write scopes, no privileged triggers");
  assert.match(TEMPLATE, /^ {2}sync-check:\n {4}runs-on: ubuntu-latest\n/m);
});

test("template: clones the tag pinned in .conventions.lock.json, the same way deploy-secrets-lint does", () => {
  const dsl = fs.readFileSync(path.join(ROOT, "templates/deploy-secrets-lint.yml"), "utf8");
  const refLine = `REF=$(node -p "'v' + require('./.conventions.lock.json').version")`;
  assert.ok(dsl.includes(refLine), "reference pattern still present");
  const fetch = stepScript("Fetch pinned conventions");
  assert.ok(fetch.includes(refLine));
  assert.match(fetch, /git clone --depth 1 --branch "\$REF" https:\/\/github\.com\/boycepoleonjr\/conventions "\$RUNNER_TEMP\/conventions"/);
  assert.match(fetch, /^set -euo pipefail$/m);
  assert.match(rendered, /scripts\/sync\.mjs" --repo \. --check/);
  assert.ok(rendered.indexOf("Fetch pinned conventions") < rendered.indexOf("Check managed files"));
});

test("template: no step can be skipped or ignored", () => {
  const steps = rendered.slice(rendered.indexOf("    steps:"));
  assert.ok(!/continue-on-error|^\s+if:|\|\| true|\|\| echo/m.test(steps));
});

test("skip: the sync-check id is the only opt-out, and a new repo gets the file", () => {
  const repo = nodeRepo();
  assert.equal(sync(repo, ["--init"]).code, 0);
  assert.equal(readF(repo, DEST), rendered.replace("0.0.0", readF(ROOT, "VERSION").trim()));
  const skipRepo = nodeRepo();
  assert.equal(sync(skipRepo, ["--init"]).code, 0);
  fs.rmSync(path.join(skipRepo, DEST));
  const cfg = JSON.parse(readF(skipRepo, ".conventions.json"));
  cfg.skip = ["sync-check"];
  write(skipRepo, ".conventions.json", JSON.stringify(cfg, null, 2) + "\n");
  const r = sync(skipRepo);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /SKIP\s+\.github\/workflows\/conventions-sync-check\.yml\s+\("sync-check" in skip\)/);
  assert.ok(!fs.existsSync(path.join(skipRepo, DEST)), "skipped file is not written");
  const others = WORKFLOWS.filter((d) => d !== DEST);
  assert.equal(others.length, 3);
  for (const d of others) assert.ok(fs.existsSync(path.join(skipRepo, d)), `skipping sync-check does not skip ${d}`);
  for (const other of ["conventions-check", "deploy-secrets-lint", "claude-review"]) {
    const r2 = nodeRepo();
    assert.equal(sync(r2, ["--init"]).code, 0);
    const c = JSON.parse(readF(r2, ".conventions.json"));
    c.skip = [other];
    fs.rmSync(path.join(r2, DEST));
    write(r2, ".conventions.json", JSON.stringify(c, null, 2) + "\n");
    assert.equal(sync(r2).code, 0);
    assert.ok(fs.existsSync(path.join(r2, DEST)), `skip ${other} must not opt out of the sync check`);
  }
});

// ---- the verify logic against the real sync.mjs ------------------------------------------------------------------------

test("clean repo: passes with nothing to report", () => {
  const repo = syncedRepo();
  const r = runCheck(repo, clone());
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /summary: 0 to write, 0 conflicts/);
  assert.doesNotMatch(r.out, /::error::|::notice::/);
});

test("a managed file edited by hand fails the job with the file named (replace, block and the check workflow itself)", () => {
  const edits = [
    [".github/workflows/conventions-check.yml", (t) => t.replace("name: Conventions check", "name: Conventions check (mine)")],
    [".github/pull_request_template.md", (t) => t + "\n## Extra\n"],
    ["AGENTS.md", (t) => t.replace("- No AI attribution in commits, PR bodies or comments.", "- Attribute everything to the bot.")],
    [DEST, (t) => t.replace("pull_request:", "pull_request_target:")],
  ];
  for (const [rel, edit] of edits) {
    const repo = syncedRepo();
    write(repo, rel, edit(readF(repo, rel)));
    const direct = sync(repo, ["--check"]);
    assert.match(direct.out, new RegExp(`CONFLICT\\s+${rel.replace(/[./]/g, "\\$&")}`), `${rel}: sync reports CONFLICT\n${direct.out}`);
    const r = runCheck(repo, clone());
    assert.equal(r.code, 1, `${rel} must fail\n${r.out}`);
    assert.match(r.out, new RegExp(`::error::A managed file was edited by hand: .*${rel.replace(/[./]/g, "\\$&")}`));
  }
});

test("bitburner PR #36 case: a hand edit to conventions-check.yml fails, and a Dependabot-only change to it passes", () => {
  const repo = syncedRepo();
  const f = ".github/workflows/conventions-check.yml";
  write(repo, f, bump(readF(repo, f)));
  const ok = runCheck(repo, clone());
  assert.equal(ok.code, 0, ok.out);
  write(repo, f, readF(repo, f).replace("cron: \"17 13 * * 1\"", "cron: \"0 0 * * *\""));
  const bad = runCheck(repo, clone());
  assert.equal(bad.code, 1, bad.out);
  assert.match(bad.out, /::error::A managed file was edited by hand: .*conventions-check\.yml/);
});

test("behind but clean: files that would be updated are a notice, not a failure", () => {
  const repo = syncedRepo();
  const newer = copyConventions("9.9.0");
  write(newer, "templates/pull_request_template.md", readF(ROOT, "templates/pull_request_template.md") + "\n## New section\n");
  assert.match(sync(repo, ["--check"], newer).out, /UPDATE\s+\.github\/pull_request_template\.md/, "setup: sync sees the repo as behind");
  assert.equal(sync(repo, ["--check"], newer).code, 1, "setup: --check itself exits 1 when behind");
  const r = runCheck(repo, newer);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /::notice::Managed files differ from the pinned conventions version, but none was edited by hand: summary: \d+ to write, 0 conflicts/);
  assert.match(r.out, /summary: ([2-9]|\d\d) to write, 0 conflicts/);
  assert.doesNotMatch(r.out, /::error::/);
});

test("Dependabot ref bump passes: bumped checkout, setup-node and claude-code-action refs, and a node-version change", () => {
  const repo = syncedRepo();
  for (const f of WORKFLOWS) write(repo, f, bump(readF(repo, f)));
  write(repo, ".github/workflows/conventions-check.yml", readF(repo, ".github/workflows/conventions-check.yml").replace("node-version: 22", "node-version: 24"));
  write(repo, DEST, readF(repo, DEST).replace("node-version: 22", "node-version: 24"));
  assert.match(readF(repo, DEST), /actions\/checkout@c{40} # v7\.0\.1/, "setup: the sync-check workflow itself was bumped");
  const r = runCheck(repo, clone());
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /::error::|::notice::|CONFLICT/);
  assert.match(r.out, /summary: 0 to write, 0 conflicts/);
});

test("Dependabot ref bump plus a hand edit in the same file still fails", () => {
  const repo = syncedRepo();
  const f = ".github/workflows/deploy-secrets-lint.yml";
  write(repo, f, bump(readF(repo, f)).replace("name: Deploy secrets lint", "name: Deploy secrets lint (mine)"));
  const r = runCheck(repo, clone());
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /::error::A managed file was edited by hand: .*deploy-secrets-lint\.yml/);
});

test("a ref changed to something that is not a full commit SHA breaks SUP-1, so it fails (it is not a repo-owned bump)", () => {
  const repo = syncedRepo();
  const f = ".github/workflows/deploy-secrets-lint.yml";
  write(repo, f, readF(repo, f).replace(/actions\/checkout@[0-9a-f]{40} # \S+/, "actions/checkout@v4"));
  const r = runCheck(repo, clone());
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /::error::A managed file was edited by hand: .*deploy-secrets-lint\.yml.*not a full commit SHA \(SUP-1\)/);
});

// ---- failures that must be loud --------------------------------------------------------------------------------------

test("fake sync output: CONFLICT fails, UPDATE-only passes with a notice, clean passes", () => {
  const conflict = runCheck(nodeRepo(), fakeSync(["conventions v1.7.1 -> . [check]", "CONFLICT  AGENTS.md  (a managed block was edited by hand since last sync)", "UPDATE   .github/dependabot.yml", "summary: 1 to write, 1 conflicts"], 1));
  assert.equal(conflict.code, 1);
  assert.match(conflict.out, /::error::A managed file was edited by hand: AGENTS\.md/);
  const two = runCheck(nodeRepo(), fakeSync(["CONFLICT  A.md  (x)", "CONFLICT  B.md  (y)", "summary: 0 to write, 2 conflicts"], 1));
  assert.match(two.out, /::error::A managed file was edited by hand: A\.md  \(x\);B\.md  \(y\)/);
  const behind = runCheck(nodeRepo(), fakeSync(["UPDATE   AGENTS.md", "CREATE   .github/workflows/new.yml", "summary: 2 to write, 0 conflicts"], 1));
  assert.equal(behind.code, 0, behind.out);
  assert.match(behind.out, /::notice::.*summary: 2 to write, 0 conflicts/);
  const clean = runCheck(nodeRepo(), fakeSync(["OK       AGENTS.md", "summary: 0 to write, 0 conflicts"], 0));
  assert.equal(clean.code, 0, clean.out);
  assert.doesNotMatch(clean.out, /::notice::|::error::/);
});

test("a sync.mjs that crashes or errors is a failure, even though it also exits 1", () => {
  const cases = {
    "uncaught exception (exit 1, no summary)": fakeConventions(`throw new Error("boom");\n`),
    "usage error (exit 3)": fakeConventions(`console.error("error: .conventions.json not found"); process.exit(3);\n`),
    "conflicts left unresolved (exit 2)": fakeSync(["summary: 0 to write, 1 conflicts"], 2),
    "exit 1 without a summary line": fakeConventions(`console.log("UPDATE   AGENTS.md"); process.exit(1);\n`),
    "exit 0 without a summary line": fakeConventions(`console.log("all good"); process.exit(0);\n`),
    "killed by a signal": fakeConventions(`process.kill(process.pid, "SIGKILL");\n`),
    "sync.mjs missing from the clone": path.join(tmp("sc-empty-"), "conventions"),
  };
  for (const [name, conv] of Object.entries(cases)) {
    const r = runCheck(nodeRepo(), conv);
    assert.equal(r.code, 1, `${name} must fail\n${r.out}`);
    assert.match(r.out, /::error::sync\.mjs --check did not finish/, name);
  }
  const noClone = runCheck(nodeRepo(), null);
  assert.equal(noClone.code, 1, "no clone directory at all fails");
  assert.match(noClone.out, /::error::sync\.mjs --check did not finish/);
});

test("a real repo without .conventions.json fails (sync exits 3), never a green pass", () => {
  const r = runCheck(nodeRepo(), clone());
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /::error::sync\.mjs --check did not finish \(exit 3\)/);
});

// The Fetch step with a fake `git` and the real `node` reading a real lock file.
function runFetch(repo, { gitExit = 0, gitArgsOut } = {}) {
  const runner = tmp("sc-fetch-");
  fs.mkdirSync(path.join(runner, "bin"));
  write(runner, "bin/git", `#!/bin/bash\necho "$@" >> "${gitArgsOut}"\n${gitExit ? `echo "fatal: unable to access" >&2\nexit ${gitExit}` : "exit 0"}\n`);
  fs.chmodSync(path.join(runner, "bin/git"), 0o755);
  const script = path.join(runner, "fetch.sh");
  fs.writeFileSync(script, stepScript("Fetch pinned conventions"));
  const r = spawnSync("bash", ["-e", script], { cwd: repo, encoding: "utf8", env: { PATH: `${runner}/bin:${process.env.PATH}`, RUNNER_TEMP: runner } });
  return { code: r.status, out: r.stdout + r.stderr, runner };
}

test("fetch: clones the tag named in the lock file", () => {
  const repo = syncedRepo();
  const log = path.join(tmp("sc-log-"), "git-args");
  fs.writeFileSync(log, "");
  const r = runFetch(repo, { gitArgsOut: log });
  assert.equal(r.code, 0, r.out);
  const version = JSON.parse(readF(repo, ".conventions.lock.json")).version;
  assert.equal(fs.readFileSync(log, "utf8").trim(), `clone --depth 1 --branch v${version} https://github.com/boycepoleonjr/conventions ${r.runner}/conventions`);
});

test("fetch: a clone or network failure fails the job loudly", () => {
  const repo = syncedRepo();
  const log = path.join(tmp("sc-log-"), "git-args");
  fs.writeFileSync(log, "");
  for (const gitExit of [128, 1, 2]) {
    const r = runFetch(repo, { gitExit, gitArgsOut: log });
    assert.equal(r.code, 1, `git exit ${gitExit}\n${r.out}`);
    assert.match(r.out, /::error::Could not clone conventions v\d+\.\d+\.\d+\. The sync check cannot run, so this is a failure, not a pass\./);
  }
});

test("fetch: a missing or unreadable lock file fails before any clone", () => {
  const log = path.join(tmp("sc-log-"), "git-args");
  fs.writeFileSync(log, "");
  const none = nodeRepo();
  assert.notEqual(runFetch(none, { gitArgsOut: log }).code, 0, "no lock file");
  const bad = nodeRepo();
  write(bad, ".conventions.lock.json", "{ not json");
  assert.notEqual(runFetch(bad, { gitArgsOut: log }).code, 0, "unparseable lock file");
  assert.equal(fs.readFileSync(log, "utf8"), "", "git was never called");
});
