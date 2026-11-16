// node --test test/*.test.mjs
// SUP-6 and SUP-7 wording (v1.9.3): no live file tells an agent or reviewer to hold actions/checkout (or
// claude-code-action) at an old version. The rule is persist-credentials: false on every checkout step, whatever the version.
// History (CHANGELOG, docs/specs, docs/handoffs) may still mention the old hold; it is not scanned.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

function walk(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return [];
  if (fs.statSync(abs).isFile()) return [rel];
  return fs.readdirSync(abs).flatMap((n) => walk(path.join(rel, n)));
}
// Everything a synced repo, an agent or a reviewer reads as a current rule.
const LIVE = ["templates", "skills", "global", "profiles", "scripts", "STANDARD.md", "README.md", "manifest.json"].flatMap(walk);

const agents = read("templates/AGENTS.md");
const block = (name) => agents.match(new RegExp(`<!-- conventions:begin ${name} -->([\\s\\S]*?)<!-- conventions:end ${name} -->`))[1];
const prompt = (() => {
  const t = read("templates/claude-code-review.yml");
  return t.match(/ {10}prompt: \|\n([\s\S]*?)\n {10}claude_args:/)[1];
})();

test("the live file list covers templates, skills, STANDARD and README", () => {
  for (const f of ["templates/AGENTS.md", "templates/claude-code-review.yml", "skills/dependency-update/SKILL.md", "STANDARD.md", "README.md"]) {
    assert.ok(LIVE.includes(f), `${f} is not scanned`);
  }
});

test("no live file mentions a checkout hold at v4.4.0 or any checkout version cap", () => {
  for (const f of LIVE) {
    read(f).split("\n").forEach((line, i) => {
      const where = `${f}:${i + 1}`;
      assert.ok(!(/checkout/i.test(line) && /\b4\.4\.0\b/.test(line)), `${where} mentions checkout and v4.4.0`);
      assert.ok(!/\b(hold|holds|held|holding|freeze|frozen)\b[^.\n]{0,60}actions\/checkout|actions\/checkout[^.\n]{0,60}\b(hold|held|frozen)\b/i.test(line), `${where} holds actions/checkout`);
      assert.ok(!/(do not|never|don't) (bump|upgrade|update|raise)[^.\n]{0,40}checkout/i.test(line), `${where} forbids a checkout bump`);
    });
  }
});

test("no live file holds claude-code-action at a version, and none has a dependabot ignore rule", () => {
  for (const f of LIVE) {
    read(f).split("\n").forEach((line, i) => {
      const where = `${f}:${i + 1}`;
      assert.ok(!/claude-code-action[^.\n]{0,60}\b(hold|held|holding|frozen|ignore)\b|\b(hold|held|holding|frozen)\b[^.\n]{0,60}claude-code-action/i.test(line), `${where} holds claude-code-action`);
      assert.ok(!/^\s*ignore:\s*$/.test(line) || !f.includes("dependabot"), `${where} has a dependabot ignore rule`);
    });
  }
});

test("the review prompt says any checkout version is fine and to flag a missing persist-credentials: false", () => {
  assert.match(prompt, /any `actions\/checkout` version is fine/);
  assert.match(prompt, /never flag the checkout version/);
  assert.match(prompt, /does not set `persist-credentials: false`/);
  assert.match(prompt, /anthropics\/claude-code-action/);
  // Still one numbered item (4), not a new step: the prompt keeps steps 1 to 6.
  assert.deepEqual([...prompt.matchAll(/^ {12}(\d)\. /gm)].map((m) => m[1]), ["1", "2", "3", "4", "5", "6"]);
});

test("the review guidelines block tells reviewers to flag the missing setting, not the version", () => {
  const review = block("agents-review");
  assert.match(review, /`actions\/checkout` step without `persist-credentials: false`/);
  assert.match(review, /Any checkout version is fine; flag the missing setting, not the version\./);
  assert.ok(review.includes("`anthropics/claude-code-action`"));
});

test("the shared rules block has the upstream-tests line exactly once, as one bullet", () => {
  const core = block("agents-core");
  const line = "- Files managed by conventions sync are tested upstream in boycepoleonjr/conventions; sync-only PRs should not be asked to add repo-level tests for them.\n";
  assert.equal(core.split(line).length - 1, 1);
  assert.equal(core.split("\n").filter((l) => /tested upstream/.test(l)).length, 1);
});

test("a synced repo gets both rules in AGENTS.md and the prompt in its review workflow, and --check is clean", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "rule-"));
  fs.writeFileSync(path.join(repo, "package.json"), JSON.stringify({ name: "demo-app", scripts: { test: "jest" } }));
  fs.writeFileSync(path.join(repo, "package-lock.json"), "{}");
  const run = (args) => {
    const r = spawnSync(process.execPath, [path.join(ROOT, "scripts/sync.mjs"), "--repo", repo, ...args], { encoding: "utf8" });
    return { code: r.status, out: r.stdout + r.stderr };
  };
  const init = run(["--init"]);
  assert.equal(init.code, 0, init.out);
  const a = fs.readFileSync(path.join(repo, "AGENTS.md"), "utf8");
  assert.ok(a.includes("tested upstream in boycepoleonjr/conventions; sync-only PRs should not be asked to add repo-level tests for them."));
  assert.ok(a.includes("flag the missing setting, not the version."));
  const wf = fs.readFileSync(path.join(repo, ".github/workflows/claude-code-review.yml"), "utf8");
  assert.ok(wf.includes("does not set `persist-credentials: false`"));
  assert.doesNotMatch(wf, /\{\{(conventions|claude_review_focus|project|commands|pr_policy)/, "unrendered placeholder");
  const check = run(["--check"]);
  assert.equal(check.code, 0, check.out);
});
