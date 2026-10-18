// node --test test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const write = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const readF = (dir, rel) => fs.readFileSync(path.join(dir, rel), "utf8");
const sync = (repo, args = [], root = ROOT) => {
  const r = spawnSync(process.execPath, [path.join(root, "scripts/sync.mjs"), "--repo", repo, ...args], { encoding: "utf8" });
  return { code: r.status, out: r.stdout + r.stderr };
};
function nodeRepo() {
  const repo = tmp("repo-");
  write(repo, "package.json", JSON.stringify({ name: "demo-app", scripts: { lint: "eslint .", test: "jest", build: "next build" } }));
  write(repo, "package-lock.json", "{}");
  write(repo, "tsconfig.json", "{}");
  return repo;
}
function copyConventions() {
  const dir = tmp("conv-");
  fs.cpSync(ROOT, dir, { recursive: true, filter: (s) => !s.includes(`${path.sep}.git`) });
  return dir;
}

test("new repo: init creates everything, second run is clean", () => {
  const repo = nodeRepo();
  const first = sync(repo, ["--init"]);
  assert.equal(first.code, 0, first.out);
  for (const f of ["AGENTS.md", "CLAUDE.md", ".github/pull_request_template.md", ".github/dependabot.yml", ".github/workflows/conventions-check.yml", "docs/specs/README.md", "docs/handoffs/README.md", ".claude/skills/open-pr/SKILL.md", ".conventions.json", ".conventions.lock.json"]) {
    assert.ok(fs.existsSync(path.join(repo, f)), `missing ${f}`);
  }
  const cfg = JSON.parse(readF(repo, ".conventions.json"));
  assert.equal(cfg.profile, "node-web");
  assert.equal(cfg.commands.install, "npm ci");
  assert.equal(cfg.commands.typecheck, "npx tsc --noEmit");
  assert.match(readF(repo, "AGENTS.md"), /# AGENTS.md: demo-app/);
  assert.match(readF(repo, "AGENTS.md"), /- lint: `npm run lint`/);
  assert.match(readF(repo, ".github/dependabot.yml"), /package-ecosystem: "npm"/);
  assert.equal(readF(repo, "CLAUDE.md").includes("@AGENTS.md"), true);
  const check = sync(repo, ["--check"]);
  assert.equal(check.code, 0, check.out);
});

test("retrofit: keeps repo-owned AGENTS.md content, inserts blocks, flags unmanaged files", () => {
  const repo = nodeRepo();
  write(repo, "AGENTS.md", "# AGENTS.md: legacy\n\n## Project\nOur own notes.\n");
  write(repo, ".github/dependabot.yml", "version: 2\nupdates: []\n");
  const r = sync(repo, ["--init"]);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /CONFLICT\s+\.github\/dependabot\.yml/);
  const agents = readF(repo, "AGENTS.md");
  assert.match(agents, /Our own notes\./);
  assert.match(agents, /conventions:begin agents-core/);
  assert.ok(agents.indexOf("agents-core") < agents.indexOf("agents-commands"));
  assert.equal(readF(repo, ".github/dependabot.yml"), "version: 2\nupdates: []\n");
  const cfg = JSON.parse(readF(repo, ".conventions.json"));
  cfg.skip = ["dependabot"];
  write(repo, ".conventions.json", JSON.stringify(cfg, null, 2) + "\n");
  assert.equal(sync(repo).code, 0);
  assert.equal(sync(repo, ["--check"]).code, 0);
});

test("retrofit: existing identical content is wrapped, not duplicated", () => {
  const repo = nodeRepo();
  write(repo, "CLAUDE.md", "@AGENTS.md\n\nClaude-only note.\n");
  assert.equal(sync(repo, ["--init"]).code, 0);
  const claude = readF(repo, "CLAUDE.md");
  assert.equal(claude.match(/@AGENTS\.md/g).length, 1, claude);
  assert.match(claude, /conventions:begin claude-import/);
  assert.match(claude, /Claude-only note\./);
  assert.equal(sync(repo, ["--check"]).code, 0);
});

test("upgrade: new conventions version updates managed parts only", () => {
  const repo = nodeRepo();
  sync(repo, ["--init"]);
  write(repo, "AGENTS.md", readF(repo, "AGENTS.md").replace("- Stack: TODO", "- Stack: Next.js 15"));
  const conv = copyConventions();
  write(conv, "VERSION", "1.1.0\n");
  write(conv, "templates/AGENTS.md", readF(conv, "templates/AGENTS.md").replace("## Shared rules", "## Shared rules\n- New rule in 1.1.0."));
  const check = sync(repo, ["--check"], conv);
  assert.equal(check.code, 1);
  assert.match(check.out, /UPDATE\s+AGENTS\.md/);
  assert.match(check.out, /v1\.0\.0 -> v1\.1\.0/);
  assert.equal(sync(repo, [], conv).code, 0);
  const agents = readF(repo, "AGENTS.md");
  assert.match(agents, /New rule in 1\.1\.0/);
  assert.match(agents, /Stack: Next\.js 15/);
  assert.match(readF(repo, ".github/pull_request_template.md"), /v1\.1\.0/);
  assert.equal(JSON.parse(readF(repo, ".conventions.lock.json")).version, "1.1.0");
});

test("hand edits to managed files are conflicts until --force", () => {
  const repo = nodeRepo();
  sync(repo, ["--init"]);
  write(repo, ".github/pull_request_template.md", "custom\n");
  write(repo, "AGENTS.md", readF(repo, "AGENTS.md").replace("Never merge.", "Merge freely."));
  const r = sync(repo);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /CONFLICT\s+\.github\/pull_request_template\.md/);
  assert.match(r.out, /CONFLICT\s+AGENTS\.md/);
  assert.equal(readF(repo, ".github/pull_request_template.md"), "custom\n");
  assert.equal(sync(repo, ["--force"]).code, 0);
  assert.match(readF(repo, "AGENTS.md"), /Never merge\./);
});

test("profile detection: python and worker", () => {
  const py = tmp("py-");
  write(py, "pyproject.toml", "[project]\nname='x'\n");
  assert.equal(sync(py, ["--init"]).code, 0);
  assert.equal(JSON.parse(readF(py, ".conventions.json")).profile, "python");
  assert.match(readF(py, ".github/dependabot.yml"), /"uv"/);
  const wk = nodeRepo();
  write(wk, "wrangler.jsonc", "{}");
  write(wk, "pnpm-lock.yaml", "");
  fs.rmSync(path.join(wk, "package-lock.json"));
  assert.equal(sync(wk, ["--init"]).code, 0);
  const cfg = JSON.parse(readF(wk, ".conventions.json"));
  assert.equal(cfg.profile, "node-worker");
  assert.equal(cfg.commands.install, "pnpm install --frozen-lockfile");
});

test("usage errors exit 3", () => {
  const repo = nodeRepo();
  assert.equal(sync(repo).code, 3);
  assert.equal(sync(repo, ["--bogus"]).code, 3);
});
