// node --test test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CUR = fs.readFileSync(path.join(ROOT, "VERSION"), "utf8").trim();
const NEXT = (() => { const [a, b] = CUR.split("."); return `${a}.${Number(b) + 1}.0`; })();
const re = (v) => v.replace(/\./g, "\\.");
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
  for (const f of ["AGENTS.md", "CLAUDE.md", ".github/pull_request_template.md", ".github/dependabot.yml", ".github/workflows/conventions-check.yml", ".github/workflows/claude-code-review.yml", ".github/workflows/deploy-secrets-lint.yml", "docs/specs/README.md", "docs/handoffs/README.md", ".claude/skills/open-pr/SKILL.md", ".conventions.json", ".conventions.lock.json"]) {
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
  write(conv, "VERSION", `${NEXT}\n`);
  write(conv, "templates/AGENTS.md", readF(conv, "templates/AGENTS.md").replace("## Shared rules", `## Shared rules\n- New rule in ${NEXT}.`));
  const check = sync(repo, ["--check"], conv);
  assert.equal(check.code, 1);
  assert.match(check.out, /UPDATE\s+AGENTS\.md/);
  assert.match(check.out, new RegExp(`v${re(CUR)} -> v${re(NEXT)}`));
  assert.equal(sync(repo, [], conv).code, 0);
  const agents = readF(repo, "AGENTS.md");
  assert.ok(agents.includes(`New rule in ${NEXT}`));
  assert.match(agents, /Stack: Next\.js 15/);
  assert.ok(readF(repo, ".github/pull_request_template.md").includes(`v${NEXT}`));
  assert.equal(JSON.parse(readF(repo, ".conventions.lock.json")).version, NEXT);
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

test("dependabot: every ecosystem has version-update groups for minor/patch and major; only github-actions ignores checkout majors", () => {
  const repo = nodeRepo();
  assert.equal(sync(repo, ["--init"]).code, 0);
  const y = readF(repo, ".github/dependabot.yml");
  for (const eco of ["npm", "github-actions"]) assert.match(y, new RegExp(`package-ecosystem: "${eco}"`));
  const entries = y.split("\n  - package-ecosystem").slice(1);
  assert.equal(entries.length, 2);
  for (const e of entries) {
    assert.match(e, /\n    groups:\n      minor-and-patch:\n        applies-to: version-updates\n        update-types: \["minor", "patch"\]\n      major:\n        applies-to: version-updates\n        update-types: \["major"\]/);
    if (e.startsWith(': "github-actions"')) {
      assert.match(e, /\n    ignore:\n      - dependency-name: "actions\/checkout"\n        update-types: \["version-update:semver-major"\]\n    groups:/);
      assert.equal(e.match(/dependency-name/g).length, 1, "only actions/checkout is ignored");
    } else {
      assert.ok(!e.includes("ignore"), "majors must not be ignored (would block security updates)");
    }
  }
  assert.ok(!y.includes("\t"), "no tabs in YAML");
});

test("dependabot: target-branch is absent by default and, when configured, set on every ecosystem", () => {
  const repo = nodeRepo();
  assert.equal(sync(repo, ["--init"]).code, 0);
  assert.ok(!readF(repo, ".github/dependabot.yml").includes("target-branch"));
  const cfg = JSON.parse(readF(repo, ".conventions.json"));
  cfg.dependabot_target_branch = "staging";
  write(repo, ".conventions.json", JSON.stringify(cfg));
  assert.equal(sync(repo, ["--force"]).code, 0);
  const y = readF(repo, ".github/dependabot.yml");
  assert.equal(y.match(/\n    target-branch: "staging"\n/g).length, 2);
  const entries = y.split("\n  - package-ecosystem").slice(1);
  for (const e of entries) assert.match(e, /open-pull-requests-limit: 5\n    target-branch: "staging"\n/);
  assert.match(y, /ignore:\n      - dependency-name: "actions\/checkout"/);
  assert.equal(sync(repo, ["--check"]).code, 0);
  cfg.dependabot_target_branch = "";
  write(repo, ".conventions.json", JSON.stringify(cfg));
  assert.equal(sync(repo, ["--force"]).code, 0);
  assert.ok(!readF(repo, ".github/dependabot.yml").includes("target-branch"), "empty string means unset");
});

test("dependabot: invalid target-branch values are rejected before anything is written", () => {
  for (const bad of ['staging"\n  evil: 1', "has space", 42, "-leading-dash", "a\nb"]) {
    const repo = nodeRepo();
    assert.equal(sync(repo, ["--init"]).code, 0);
    const before = readF(repo, ".github/dependabot.yml");
    const cfg = JSON.parse(readF(repo, ".conventions.json"));
    cfg.dependabot_target_branch = bad;
    write(repo, ".conventions.json", JSON.stringify(cfg));
    const r = sync(repo, ["--force"]);
    assert.notEqual(r.code, 0, `${JSON.stringify(bad)} must fail`);
    assert.match(r.out, /dependabot_target_branch/);
    assert.equal(readF(repo, ".github/dependabot.yml"), before);
  }
});

const WF = ".github/workflows/claude-code-review.yml";
const yamlParses = (text) => {
  const probe = spawnSync("python3", ["-c", "import yaml"]);
  if (probe.status !== 0) return null; // PyYAML not installed; structural checks below still run
  const r = spawnSync("python3", ["-c", "import sys,yaml,json;print(json.dumps(yaml.safe_load(sys.stdin.read())))"], { input: text, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
};
const stepsOf = (wf) => wf.jobs["claude-review"].steps;
const promptOf = (wf) => stepsOf(wf).find((st) => st.with && st.with.prompt).with.prompt;
const GH_EXPRS = ["${{ github.event.pull_request.number }}", "${{ github.repository }}", "${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}"];

test("claude-review workflow: renders without focus, GitHub expressions intact, no blank line left behind", () => {
  const repo = nodeRepo();
  assert.equal(sync(repo, ["--init"]).code, 0);
  const y = readF(repo, WF);
  assert.ok(y.startsWith(`# Synced from boycepoleonjr/conventions v${CUR} `));
  for (const e of GH_EXPRS) assert.ok(y.includes(e), `lost ${e}`);
  assert.ok(!y.includes("{{conventions") && !y.includes("claude_review_focus"));
  assert.ok(!y.includes("Repo-specific focus"));
  assert.match(y, /Always finish by posting exactly one summary comment[^\n]*\n {10}claude_args: \|/);
  assert.match(y, /claude-code-action@[0-9a-f]{40} # v1\.\d+\.\d+/);
  const wf = yamlParses(y);
  if (wf) {
    assert.equal(wf.name, "Claude Code Review");
    assert.ok(!promptOf(wf).includes("Repo-specific focus"));
    assert.match(promptOf(wf), /PR NUMBER: \$\{\{ github\.event\.pull_request\.number \}\}/);
  }
  assert.equal(sync(repo, ["--check"]).code, 0);
});

test("claude-review workflow: reviews every push, fails loudly without the secret, dedupes against earlier comments", () => {
  const repo = nodeRepo();
  assert.equal(sync(repo, ["--init"]).code, 0);
  const y = readF(repo, WF);
  assert.match(y, /types: \[opened, synchronize, reopened, ready_for_review\]/);
  assert.match(y, /cancel-in-progress: true/);
  assert.match(y, /timeout-minutes: 30\n/);
  assert.match(y, /allowed_bots: "cursor"/, "double quotes keep the file Prettier-clean");
  const wf = yamlParses(y);
  if (wf) {
    assert.deepEqual(wf[true].pull_request.types, ["opened", "synchronize", "reopened", "ready_for_review"]);
    const job = wf.jobs["claude-review"];
    assert.equal(job["timeout-minutes"], 30);
    const first = stepsOf(wf)[0];
    assert.match(first.name, /CLAUDE_CODE_OAUTH_TOKEN/);
    assert.equal(first.env.HAS_TOKEN, "${{ secrets.CLAUDE_CODE_OAUTH_TOKEN != '' }}");
    assert.match(first.run, /\[ "\$HAS_TOKEN" != "true" \]/);
    assert.match(first.run, /::error::CLAUDE_CODE_OAUTH_TOKEN is not set/);
    assert.match(first.run, /exit 1/);
    assert.ok(!first.uses && !("continue-on-error" in first) && !first.if, "secret check is unconditional and cannot be ignored");
    assert.ok(stepsOf(wf).findIndex((st) => st.with && st.with.prompt) > 0, "secret check runs before the review step");
    const prompt = promptOf(wf);
    assert.match(prompt, /FULL diff of the PR on every run/);
    assert.match(prompt, /gh pr view \$\{\{ github\.event\.pull_request\.number \}\} --comments/);
    assert.match(prompt, /gh api repos\/\$\{\{ github\.repository \}\}\/pulls\/\$\{\{ github\.event\.pull_request\.number \}\}\/comments --paginate/);
    assert.match(prompt, /GET requests only/);
    assert.match(prompt, /Do not repeat a finding that is already posted and still applies/);
    assert.match(prompt, /first review or a re-review/);
    assert.match(prompt, /head SHA/);
    assert.match(prompt, /No new issues found/);
    const claudeStep = stepsOf(wf).find((st) => st.with && st.with.claude_args);
    assert.match(claudeStep.with.claude_args, /Bash\(gh api repos\/\$\{\{ github\.repository \}\}\/pulls\/\$\{\{ github\.event\.pull_request\.number \}\}\/comments:\*\)/);
    assert.ok(!/Bash\(gh api:\*\)/.test(claudeStep.with.claude_args), "gh api is scoped to this PR's review comments");
  }
  // without PyYAML the text checks still pin the order: secret check before checkout and review
  assert.ok(y.indexOf("Require CLAUDE_CODE_OAUTH_TOKEN") < y.indexOf("actions/checkout@"));
  assert.ok(y.indexOf("actions/checkout@") < y.indexOf("claude-code-action@"));
  for (const e of GH_EXPRS) assert.ok(y.includes(e), `lost ${e}`);
});

test("claude-review workflow: claude_review.focus is indented into the prompt block, expressions untouched", () => {
  const repo = nodeRepo();
  assert.equal(sync(repo, ["--init"]).code, 0);
  const cfg = JSON.parse(readF(repo, ".conventions.json"));
  cfg.claude_review = { focus: "Check RLS on new tables.\n\nNo raw SQL in routes: use the query builder.\n" };
  write(repo, ".conventions.json", JSON.stringify(cfg, null, 2) + "\n");
  assert.equal(sync(repo).code, 0);
  const y = readF(repo, WF);
  const pad = " ".repeat(12);
  assert.ok(y.includes(`5. Always finish`), "prompt step 4 present");
  assert.match(y, new RegExp(`\\n\\n${pad}Repo-specific focus:\\n${pad}Check RLS on new tables\\.\\n\\n${pad}No raw SQL in routes: use the query builder\\.\\n {10}claude_args: \\|`));
  for (const e of GH_EXPRS) assert.ok(y.includes(e), `lost ${e}`);
  // every prompt line is blank or indented at least 12 spaces
  const lines = y.split("\n");
  const start = lines.findIndex((l) => l.trim() === "prompt: |") + 1;
  const end = lines.findIndex((l) => l.trim() === "claude_args: |");
  for (const l of lines.slice(start, end)) assert.ok(l === "" || l.startsWith(pad), `bad indent: ${JSON.stringify(l)}`);
  const wf = yamlParses(y);
  if (wf) {
    assert.match(promptOf(wf), /Repo-specific focus:\n {0}Check RLS on new tables\.\n\nNo raw SQL in routes: use the query builder\./);
    assert.match(promptOf(wf), /gh pr view \$\{\{ github\.event\.pull_request\.number \}\}/);
  }
  assert.equal(sync(repo, ["--check"]).code, 0);
  // removing the focus renders the no-focus file again
  delete cfg.claude_review;
  write(repo, ".conventions.json", JSON.stringify(cfg, null, 2) + "\n");
  assert.equal(sync(repo).code, 0);
  assert.ok(!readF(repo, WF).includes("Repo-specific focus"));
});

test("claude-review workflow: focus with a GitHub expression is rejected", () => {
  const repo = nodeRepo();
  assert.equal(sync(repo, ["--init"]).code, 0);
  const cfg = JSON.parse(readF(repo, ".conventions.json"));
  cfg.claude_review = { focus: "echo ${{ secrets.X }}" };
  write(repo, ".conventions.json", JSON.stringify(cfg, null, 2) + "\n");
  const r = sync(repo);
  assert.equal(r.code, 3, r.out);
  assert.match(r.out, /must not contain/);
});

test("claude-review: skip opts out", () => {
  const repo = nodeRepo();
  assert.equal(sync(repo, ["--init"]).code, 0);
  const cfg = JSON.parse(readF(repo, ".conventions.json"));
  cfg.skip = ["claude-review"];
  write(repo, ".conventions.json", JSON.stringify(cfg, null, 2) + "\n");
  assert.match(sync(repo, ["--check"]).out, /SKIP\s+\.github\/workflows\/claude-code-review\.yml/);
});

test("--only: init installs and locks just the listed files; check, force and later full sync behave", () => {
  const repo = nodeRepo();
  const first = sync(repo, ["--init", "--only", "claude-review"]);
  assert.equal(first.code, 0, first.out);
  assert.ok(fs.existsSync(path.join(repo, WF)));
  assert.ok(fs.existsSync(path.join(repo, ".conventions.json")));
  for (const f of ["AGENTS.md", "CLAUDE.md", ".github/dependabot.yml", ".github/pull_request_template.md", ".claude/skills/open-pr/SKILL.md"]) {
    assert.ok(!fs.existsSync(path.join(repo, f)), `--only must not write ${f}`);
  }
  const lock = JSON.parse(readF(repo, ".conventions.lock.json"));
  assert.deepEqual(Object.keys(lock.files), [WF]);
  assert.equal(sync(repo, ["--check", "--only", "claude-review"]).code, 0);
  // full check sees the other files as not yet adopted
  assert.equal(sync(repo, ["--check"]).code, 1);
  // hand edit: conflict on --only, overwritten with --force --only
  write(repo, WF, "name: custom\n");
  const c = sync(repo, ["--only", "claude-review"]);
  assert.equal(c.code, 2, c.out);
  assert.equal(readF(repo, WF), "name: custom\n");
  assert.equal(sync(repo, ["--only", "claude-review", "--force"]).code, 0);
  assert.match(readF(repo, WF), /name: Claude Code Review/);
  assert.equal(sync(repo, ["--check", "--only", "claude-review"]).code, 0);
  // later full sync: already-matching file is clean, the rest is created, then everything is clean
  const full = sync(repo);
  assert.equal(full.code, 0, full.out);
  assert.match(full.out, /OK\s+\.github\/workflows\/claude-code-review\.yml/);
  assert.ok(fs.existsSync(path.join(repo, "AGENTS.md")));
  assert.equal(sync(repo, ["--check"]).code, 0);
  const lock2 = JSON.parse(readF(repo, ".conventions.lock.json"));
  assert.ok(lock2.files[WF] && lock2.files["AGENTS.md"]);
});

test("--only: accepts several ids, keeps other lock entries, rejects unknown ids", () => {
  const repo = nodeRepo();
  assert.equal(sync(repo, ["--init"]).code, 0);
  const lockBefore = readF(repo, ".conventions.lock.json");
  write(repo, "AGENTS.md", readF(repo, "AGENTS.md").replace("Never merge.", "Merge freely."));
  fs.rmSync(path.join(repo, WF));
  const r = sync(repo, ["--only", "claude-review,pr-template"]);
  assert.equal(r.code, 0, r.out);
  assert.ok(fs.existsSync(path.join(repo, WF)));
  assert.match(readF(repo, "AGENTS.md"), /Merge freely\./, "unlisted file untouched");
  assert.ok(!r.out.includes("AGENTS.md"), "unlisted file not reported");
  assert.equal(readF(repo, ".conventions.lock.json"), lockBefore, "other lock entries preserved");
  const bad = sync(repo, ["--only", "nope"]);
  assert.equal(bad.code, 3, bad.out);
  assert.match(bad.out, /unknown manifest id nope/);
  assert.equal(sync(repo, ["--only"]).code, 3);
});

const unspaced = (t) => t.replace(/(<!-- conventions:begin \S+ -->)\n\n/g, "$1\n").replace(/\n\n(<!-- conventions:end \S+ -->)/g, "\n$1");
const BLOCK_SPACING = /<!-- conventions:begin (\S+) -->\n\n[\s\S]*\n\n<!-- conventions:end \1 -->/;

test("prettier-clean markdown: blocks have a blank line after the begin marker, repo text can follow without drift", () => {
  const repo = nodeRepo();
  assert.equal(sync(repo, ["--init"]).code, 0);
  for (const f of ["AGENTS.md", "CLAUDE.md"]) {
    const text = readF(repo, f);
    for (const m of text.matchAll(/<!-- conventions:begin (\S+) -->\n(.)/g)) assert.equal(m[2], "\n", `${f} ${m[1]}: blank line after begin marker`);
    assert.match(text, BLOCK_SPACING);
  }
  assert.match(readF(repo, ".github/pull_request_template.md"), /\| Command {3}\| Result \|\n\| -{9} \| -{6} \|/, "aligned table");
  write(repo, "AGENTS.md", readF(repo, "AGENTS.md") + "\n## Notes\n\n- Repo item.\n");
  write(repo, "CLAUDE.md", readF(repo, "CLAUDE.md") + "\nClaude-only note.\n");
  assert.equal(sync(repo, ["--check"]).code, 0);
});

test("upgrade from unspaced (pre-1.3.1) blocks: managed blocks reformatted, repo text untouched, then clean", () => {
  const repo = nodeRepo();
  const old = copyConventions();
  for (const t of ["templates/AGENTS.md", "templates/CLAUDE.md"]) write(old, t, unspaced(readF(old, t)));
  assert.equal(sync(repo, ["--init"], old).code, 0);
  assert.ok(readF(repo, "AGENTS.md").includes("-->\n## Shared rules"), "fixture is unspaced");
  write(repo, "AGENTS.md", readF(repo, "AGENTS.md").replace("- Stack: TODO", "- Stack: Next.js 15"));
  const before = readF(repo, "AGENTS.md");
  const check = sync(repo, ["--check"]);
  assert.equal(check.code, 1, check.out);
  assert.match(check.out, /UPDATE\s+AGENTS\.md/);
  assert.equal(sync(repo).code, 0);
  const after = readF(repo, "AGENTS.md");
  const strip = (t) => t.replace(/<!-- conventions:begin (\S+) -->[\s\S]*?<!-- conventions:end \1 -->/g, "<$1>");
  assert.equal(strip(after), strip(before));
  assert.match(after, /Stack: Next\.js 15/);
  assert.match(after, /<!-- conventions:begin agents-core -->\n\n## Shared rules/);
  assert.equal(sync(repo, ["--check"]).code, 0);
});

test("block insertion keeps one blank line around the block (retrofit and missing-block paths)", () => {
  const repo = nodeRepo();
  write(repo, "AGENTS.md", "# AGENTS.md: legacy\nOur own notes right under the title.\n");
  write(repo, "CLAUDE.md", "Claude-only note.\n@AGENTS.md\nMore notes.\n");
  assert.equal(sync(repo, ["--init"]).code, 0);
  const agents = readF(repo, "AGENTS.md");
  assert.match(agents, /^# AGENTS\.md: legacy\n\n<!-- conventions:begin agents-core -->/);
  assert.match(agents, /<!-- conventions:end agents-commands -->\n\nOur own notes right under the title\.\n$/);
  assert.ok(!/\n\n\n/.test(agents), "no double blank lines");
  const claude = readF(repo, "CLAUDE.md");
  assert.match(claude, /^Claude-only note\.\n\n<!-- conventions:begin claude-import -->\n\n@AGENTS\.md\n\n<!-- conventions:end claude-import -->\n\nMore notes\.\n$/);
  assert.equal(sync(repo, ["--check"]).code, 0);
});
