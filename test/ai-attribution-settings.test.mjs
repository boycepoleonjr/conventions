// node --test test/*.test.mjs
// Synced .claude/settings.json keeps Claude Code from adding AI attribution.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SETTINGS = ".claude/settings.json";
const tpl = JSON.parse(fs.readFileSync(path.join(ROOT, "templates/claude-settings.json"), "utf8"));
const sync = (repo, args = []) => {
  const r = spawnSync(process.execPath, [path.join(ROOT, "scripts/sync.mjs"), "--repo", repo, ...args], { encoding: "utf8" });
  return { code: r.status, out: r.stdout + r.stderr };
};
function nodeRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "attr-"));
  fs.writeFileSync(path.join(repo, "package.json"), JSON.stringify({ name: "demo-app", scripts: { test: "jest" } }));
  fs.writeFileSync(path.join(repo, "package-lock.json"), "{}");
  fs.writeFileSync(path.join(repo, "tsconfig.json"), "{}");
  return repo;
}
const put = (repo, text) => { fs.mkdirSync(path.join(repo, ".claude"), { recursive: true }); fs.writeFileSync(path.join(repo, SETTINGS), text); };
const get = (repo) => JSON.parse(fs.readFileSync(path.join(repo, SETTINGS), "utf8"));

test("template sets every attribution key off", () => {
  assert.equal(tpl.includeCoAuthoredBy, false);
  assert.deepEqual(tpl.attribution, { commit: "", pr: "", sessionUrl: false });
});

test("manifest installs the template as a json-merge file", () => {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
  const f = m.files.find((x) => x.id === "claude-settings");
  assert.ok(f);
  assert.equal(f.src, "templates/claude-settings.json");
  assert.equal(f.dest, SETTINGS);
  assert.equal(f.mode, "json-merge");
});

test("AGENTS template carries the no-attribution rule inside the synced core block", () => {
  const t = fs.readFileSync(path.join(ROOT, "templates/AGENTS.md"), "utf8");
  const core = t.match(/<!-- conventions:begin agents-core -->([\s\S]*?)<!-- conventions:end agents-core -->/)[1];
  assert.ok(core.includes("- No AI attribution in commits, PR bodies or comments.\n"));
});

test("a new repo gets the file, and a second sync and --check are clean", () => {
  const repo = nodeRepo();
  assert.equal(sync(repo, ["--init"]).code, 0);
  assert.deepEqual(get(repo), tpl);
  assert.equal(sync(repo, ["--check"]).code, 0);
  assert.match(fs.readFileSync(path.join(repo, "AGENTS.md"), "utf8"), /No AI attribution in commits, PR bodies or comments\./);
});

test("an existing file keeps every other key and gains the managed ones", () => {
  const repo = nodeRepo();
  assert.equal(sync(repo, ["--init", "--only", "pr-template"]).code, 0);
  put(repo, JSON.stringify({ model: "x", permissions: { allow: ["Bash(npm test)"], deny: ["Read(./.env)"] }, attribution: { commit: "Signed", custom: 1 } }, null, 2));
  assert.equal(sync(repo, ["--check", "--only", "claude-settings"]).code, 1, "drift is reported");
  assert.equal(sync(repo, ["--only", "claude-settings"]).code, 0);
  const got = get(repo);
  assert.equal(got.model, "x");
  assert.deepEqual(got.permissions, { allow: ["Bash(npm test)"], deny: ["Read(./.env)"] });
  assert.equal(got.attribution.commit, "", "managed key wins");
  assert.equal(got.attribution.pr, "");
  assert.equal(got.attribution.sessionUrl, false);
  assert.equal(got.attribution.custom, 1, "unmanaged sub-key kept");
  assert.equal(got.includeCoAuthoredBy, false);
  assert.equal(sync(repo, ["--check", "--only", "claude-settings"]).code, 0);
});

test("an already-correct file is not rewritten", () => {
  const repo = nodeRepo();
  const text = `{ "attribution": {"commit":"","pr":"","sessionUrl":false}, "includeCoAuthoredBy": false, "z": [1,2] }\n`;
  put(repo, text);
  assert.equal(sync(repo, ["--init"]).code, 0);
  assert.equal(fs.readFileSync(path.join(repo, SETTINGS), "utf8"), text);
});

test("a hand edit that turns attribution back on is reported and fixed", () => {
  const repo = nodeRepo();
  assert.equal(sync(repo, ["--init"]).code, 0);
  const g = get(repo); g.attribution.pr = "Generated"; put(repo, JSON.stringify(g));
  assert.equal(sync(repo, ["--check"]).code, 1);
  assert.equal(sync(repo).code, 0);
  assert.equal(get(repo).attribution.pr, "");
});

test("invalid or non-object JSON is a conflict and is left untouched", () => {
  for (const bad of ["{ nope", "[]", "null", "42"]) {
    const repo = nodeRepo();
    put(repo, bad);
    const r = sync(repo, ["--init"]);
    assert.equal(r.code, 2, `${bad}\n${r.out}`);
    assert.match(r.out, /CONFLICT\s+\.claude\/settings\.json/);
    assert.equal(fs.readFileSync(path.join(repo, SETTINGS), "utf8"), bad);
  }
});

test("skip opts out and leaves the file alone", () => {
  const repo = nodeRepo();
  assert.equal(sync(repo, ["--init"]).code, 0);
  fs.rmSync(path.join(repo, ".claude"), { recursive: true, force: true });
  const cfg = JSON.parse(fs.readFileSync(path.join(repo, ".conventions.json"), "utf8"));
  cfg.skip = ["claude-settings"];
  fs.writeFileSync(path.join(repo, ".conventions.json"), JSON.stringify(cfg));
  const r = sync(repo);
  assert.match(r.out, /SKIP\s+\.claude\/settings\.json/);
  assert.ok(!fs.existsSync(path.join(repo, SETTINGS)));
});
