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
  write(conv, "VERSION", "1.2.0\n");
  write(conv, "templates/AGENTS.md", readF(conv, "templates/AGENTS.md").replace("## Shared rules", "## Shared rules\n- New rule in 1.2.0."));
  const check = sync(repo, ["--check"], conv);
  assert.equal(check.code, 1);
  assert.match(check.out, /UPDATE\s+AGENTS\.md/);
  assert.match(check.out, /v1\.1\.0 -> v1\.2\.0/);
  assert.equal(sync(repo, [], conv).code, 0);
  const agents = readF(repo, "AGENTS.md");
  assert.match(agents, /New rule in 1\.2\.0/);
  assert.match(agents, /Stack: Next\.js 15/);
  assert.match(readF(repo, ".github/pull_request_template.md"), /v1\.2\.0/);
  assert.equal(JSON.parse(readF(repo, ".conventions.lock.json")).version, "1.2.0");
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

const V100_AGENTS = `# AGENTS.md: demo-app

Repo intro.

<!-- conventions:begin agents-core -->
## Shared rules (conventions v1.0.0)
- Old rule.
<!-- conventions:end agents-core -->

## Project
Repo-owned notes.

- Stack: Next.js 15

<!-- conventions:begin agents-commands -->
## Commands
- lint: \`npm run lint\`
<!-- conventions:end agents-commands -->

## Repo rules
Keep this text.
`;

test("upgrade from 1.0.0: agents-review is inserted after agents-core, repo text untouched, --check drifts then clears", () => {
  const repo = nodeRepo();
  write(repo, "AGENTS.md", V100_AGENTS);
  const before = readF(repo, "AGENTS.md");
  const check = sync(repo, ["--init", "--check"]);
  assert.equal(check.code, 1, check.out);
  assert.match(check.out, /UPDATE\s+AGENTS\.md\s+\(inserted agents-review\)/);
  assert.equal(readF(repo, "AGENTS.md"), before, "--check must not write");
  const r = sync(repo, ["--init"]);
  assert.notEqual(r.code, 3, r.out);
  const agents = readF(repo, "AGENTS.md");
  const i = (s) => agents.indexOf(s);
  assert.ok(i("begin agents-core") < i("begin agents-review"));
  assert.ok(i("end agents-core") < i("begin agents-review"));
  assert.ok(i("end agents-review") < i("begin agents-commands"));
  assert.match(agents, /## Review guidelines/);
  // Everything outside the (re-rendered) blocks is byte-identical to before.
  const strip = (t) => t.replace(/<!-- conventions:begin (\S+) -->[\s\S]*?<!-- conventions:end \1 -->/g, "<$1>");
  assert.equal(strip(agents).replace("<agents-review>\n\n", ""), strip(before));
  assert.match(agents, /Repo-owned notes\.\n\n- Stack: Next\.js 15/);
  assert.match(agents, /## Repo rules\nKeep this text\.\n$/);
  assert.equal(sync(repo, ["--check"]).code, 0);
});

test("dependabot: every ecosystem has version-update groups for minor/patch and major, no ignore", () => {
  const repo = nodeRepo();
  assert.equal(sync(repo, ["--init"]).code, 0);
  const y = readF(repo, ".github/dependabot.yml");
  for (const eco of ["npm", "github-actions"]) assert.match(y, new RegExp(`package-ecosystem: "${eco}"`));
  const entries = y.split("\n  - package-ecosystem").slice(1);
  assert.equal(entries.length, 2);
  for (const e of entries) {
    assert.match(e, /\n    groups:\n      minor-and-patch:\n        applies-to: version-updates\n        update-types: \["minor", "patch"\]\n      major:\n        applies-to: version-updates\n        update-types: \["major"\]/);
    assert.ok(!e.includes("ignore"), "majors must not be ignored (would block security updates)");
  }
  assert.ok(!y.includes("\t"), "no tabs in YAML");
});
