#!/bin/bash
# One-time bootstrap: recreates conventions v1.0.0 files. Run from the repo root, then delete this file.
set -euo pipefail
mkdir -p "$(dirname '.github/workflows/test.yml')"
cat > '.github/workflows/test.yml' <<'__CONV_EOF__'
name: test
on:
  pull_request:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node: [20, 22]
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0
        with:
          node-version: ${{ matrix.node }}
      - run: node --test test/*.test.mjs
      - run: bash -n scripts/cloud-setup.sh
__CONV_EOF__
mkdir -p "$(dirname 'CHANGELOG.md')"
cat > 'CHANGELOG.md' <<'__CONV_EOF__'
# Changelog

## 1.0.0 (2026-10-18)
- First release: STANDARD.md baseline, agent docs (AGENTS.md blocks + CLAUDE.md import), PR template, Dependabot by profile, docs/specs and docs/handoffs seeds, weekly drift-check workflow, three shared skills (open-pr, fix-with-regression-tests, dependency-update), global CLAUDE.md, sync.mjs, cloud-setup.sh.
- Rules from A/B runs AB-001 and AB-002: cover every path of a fix with tests; declare dependency changes openly; draft PR first, ready for review once green.
__CONV_EOF__
mkdir -p "$(dirname 'LICENSE')"
cat > 'LICENSE' <<'__CONV_EOF__'
MIT License

Copyright (c) 2026 Boyce Poleon, Jr.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
__CONV_EOF__
mkdir -p "$(dirname 'README.md')"
cat > 'README.md' <<'__CONV_EOF__'
# conventions

Engineering conventions for my repositories, written for both people and coding agents (Claude Code, Cursor, Codex). Public on purpose: it holds no secrets, and cloud agent sessions can fetch it without credentials.

## What's here

| Path | Purpose |
|---|---|
| `STANDARD.md` | The baseline every repo is measured against, with stable IDs |
| `templates/` | Files synced into repos (agent docs, PR template, Dependabot, drift check) |
| `profiles/` | Stack defaults: commands and Dependabot ecosystems |
| `skills/` | Shared Claude Code skills, synced to each repo's `.claude/skills/` |
| `global/CLAUDE.md` | User-level agent rules, installed into `~/.claude/` locally and in cloud sessions |
| `scripts/sync.mjs` | Applies the conventions to a repo. Node 20+, no dependencies |
| `scripts/cloud-setup.sh` | Setup script for Claude Code cloud environments |

## Use it in a repo

```bash
git clone --depth 1 --branch v1.0.0 https://github.com/boycepoleonjr/conventions /tmp/conventions
node /tmp/conventions/scripts/sync.mjs --repo . --init   # first time: writes .conventions.json, then syncs
node /tmp/conventions/scripts/sync.mjs --repo .          # later: update to the checked-out version
node /tmp/conventions/scripts/sync.mjs --repo . --check  # report drift, exit 1 if anything would change
```

`sync.mjs` never touches repo-owned content:

- **block** files (for example `AGENTS.md`) only change between `<!-- conventions:begin <id> -->` and `<!-- conventions:end <id> -->` markers. Everything outside the markers belongs to the repo.
- **replace** files are fully managed. If a managed file was edited by hand since the last sync, sync reports `CONFLICT` and leaves it alone unless you pass `--force`.
- **seed** files are created once and never updated.

Each repo records its settings in `.conventions.json` and the last applied version and hashes in `.conventions.lock.json`. Opt out of a file by adding its id to `"skip"`.

## Cloud sessions

Point a Claude Code cloud environment's setup script at:

```bash
curl -fsSL https://raw.githubusercontent.com/boycepoleonjr/conventions/v1/scripts/cloud-setup.sh | CONVENTIONS_REF=v1 bash || true
```

## Versioning

SemVer tags (`v1.0.0`), plus a moving major tag (`v1`) that always points at the latest 1.x release. Cloud environments and the drift check track `v1`; repos record the exact version they applied in `.conventions.lock.json`. Patch: wording fixes. Minor: new rules, files or profiles. Major: a change that needs manual work in repos (renamed markers, removed files). See `CHANGELOG.md`.
__CONV_EOF__
mkdir -p "$(dirname 'STANDARD.md')"
cat > 'STANDARD.md' <<'__CONV_EOF__'
# Repository standard

Each item has a stable ID so audits and PRs can reference it. "Synced" means `sync.mjs` installs it; the rest are checked in an audit and fixed by hand or by a dedicated PR.

## DOC: agent and human docs
- **DOC-1** `AGENTS.md` with the shared rules block, the commands block, and repo-owned Project and Repo rules sections. *(synced)*
- **DOC-2** `CLAUDE.md` that imports `AGENTS.md` (`@AGENTS.md`), so Claude Code, Cursor and Codex read the same instructions. *(synced)*
- **DOC-3** `docs/specs/` for plans and `docs/handoffs/` for session handoffs. *(synced, seed)*
- **DOC-4** README states what the project is, how to run it, and where it deploys.

## FLOW: engineering workflow
- **FLOW-1** One branch per task, named `<type>/<slug>`. Conventional Commits.
- **FLOW-2** Open a draft PR after the first commit; mark it ready for review once every local check passes and CI is green. AI reviews trigger on ready.
- **FLOW-3** PR description uses the PR template: what, why, commands run with pass/fail, risk, and decisions needed. *(synced)*
- **FLOW-4** Minimal diffs: no refactors or unrelated edits in a fix PR.
- **FLOW-5** Agents never merge. Humans (or an orchestrator acting under explicit rules) merge.
- **FLOW-6** Non-trivial work gets a plan in `docs/specs/` before code.

## TEST: verification
- **TEST-1** A bug fix adds regression tests covering every path of the fix: empty, invalid and valid input, plus any guard added. Not just the reported repro. *(skill: fix-with-regression-tests)*
- **TEST-2** Report the real exit code of every check; never claim a pass you did not observe.

## CI: continuous integration
- **CI-1** Install from the lockfile with one package manager per repo.
- **CI-2** Required checks on the default branch: lint, typecheck, tests, build.
- **CI-3** Secret scanning and a dependency audit (high severity fails).
- **CI-4** Claude review on PR ready plus on-demand `@claude`; one trigger workflow. Codex or Cursor review as second reviewer on important repos. Bot PRs skip AI review instead of failing.
- **CI-5** Weekly conventions drift check. *(synced)*

## SUP: supply chain and permissions
- **SUP-1** Third-party actions pinned to a full commit SHA.
- **SUP-2** Dependabot weekly for github-actions and the package ecosystem. *(synced)*
- **SUP-3** Workflow `permissions:` least privilege, default `contents: read`.
- **SUP-4** Dependency changes are declared openly in the manifest. Never hide a version change inside `overrides`/`resolutions` while the manifest claims a different range; if an override is unavoidable, explain it in the PR. *(skill: dependency-update)*

## DEP: deploy
- **DEP-1** Auto-deploy on merge to the production branch; secrets live only in the host or repo secrets.
- **DEP-2** PR previews where the host supports them.

## SET: repository settings
- **SET-1** Default branch protected: PR required, required checks, no force push.
- **SET-2** Squash merge by default; head branches deleted after merge.
__CONV_EOF__
mkdir -p "$(dirname 'VERSION')"
cat > 'VERSION' <<'__CONV_EOF__'
1.0.0
__CONV_EOF__
mkdir -p "$(dirname 'global/CLAUDE.md')"
cat > 'global/CLAUDE.md' <<'__CONV_EOF__'
# Global conventions (all projects)

Installed from https://github.com/boycepoleonjr/conventions. Project instructions (`AGENTS.md`, `CLAUDE.md`) refine these defaults; follow the repo where they differ.

## Before changing code
- Find the repository root and read its `AGENTS.md`/`CLAUDE.md`, README, manifests and lockfiles, scripts and CI workflows. Use the repo's real commands and conventions.
- Treat notes and remembered project details as hints. Verify the current branch, default branch, scripts and deploy setup in the repo.
- Do not apply a preferred stack, framework or architecture across unrelated repos. Ask before broad migrations, new toolchains or major dependency upgrades.

## Verification
- Verify by observing real behavior: exit codes, rendered output, response bytes, row counts. "Passes" means the tooling is green and the change was seen doing what it should.
- Report a command's real exit code even when piping output (`set -o pipefail` or `${PIPESTATUS[0]}`). Never hide `git commit` or `git push` errors.
- When results are capped or truncated, say how many items were omitted. Never present a partial result as complete.

## Git and PRs
- Conventional Commits. One branch per task (`<type>/<slug>`). Never work directly on a protected branch.
- Draft PR after the first commit; ready for review only when checks pass and CI is green. Never merge unless explicitly told to merge that PR.
- Verify the actual default and protected branches; do not assume `main`.

## Secrets and sensitive data
- Never read, print or edit `.env*` files (except `.env.example`) or key material. Say which variable to set instead.
- Use synthetic or redacted data in tests, examples, logs and PR text. Treat personal, financial, client and family data as sensitive, even in private repos.
- No production writes or irreversible actions (deploys, destructive migrations, DNS, deleting data) without explicit approval.

## Writing
- Write reviews, analyses and handoffs in first person, addressing the reader as "you", so they can be pasted as-is.
__CONV_EOF__
mkdir -p "$(dirname 'manifest.json')"
cat > 'manifest.json' <<'__CONV_EOF__'
{
  "files": [
    { "id": "agents-md", "src": "templates/AGENTS.md", "dest": "AGENTS.md", "mode": "block", "blocks": ["agents-core", "agents-commands"] },
    { "id": "claude-md", "src": "templates/CLAUDE.md", "dest": "CLAUDE.md", "mode": "block", "blocks": ["claude-import"] },
    { "id": "pr-template", "src": "templates/pull_request_template.md", "dest": ".github/pull_request_template.md", "mode": "replace" },
    { "id": "dependabot", "src": "templates/dependabot.yml", "dest": ".github/dependabot.yml", "mode": "replace" },
    { "id": "conventions-check", "src": "templates/conventions-check.yml", "dest": ".github/workflows/conventions-check.yml", "mode": "replace" },
    { "id": "specs-readme", "src": "templates/specs-README.md", "dest": "docs/specs/README.md", "mode": "seed" },
    { "id": "handoffs-readme", "src": "templates/handoffs-README.md", "dest": "docs/handoffs/README.md", "mode": "seed" },
    { "id": "skill-open-pr", "src": "skills/open-pr/SKILL.md", "dest": ".claude/skills/open-pr/SKILL.md", "mode": "replace" },
    { "id": "skill-fix-with-regression-tests", "src": "skills/fix-with-regression-tests/SKILL.md", "dest": ".claude/skills/fix-with-regression-tests/SKILL.md", "mode": "replace" },
    { "id": "skill-dependency-update", "src": "skills/dependency-update/SKILL.md", "dest": ".claude/skills/dependency-update/SKILL.md", "mode": "replace" }
  ]
}
__CONV_EOF__
mkdir -p "$(dirname 'profiles/generic.json')"
cat > 'profiles/generic.json' <<'__CONV_EOF__'
{
  "description": "Any other stack. Fill commands in .conventions.json",
  "commands": {
    "install": "",
    "lint": "",
    "typecheck": "",
    "test": "",
    "build": "",
    "audit": ""
  },
  "dependabot": ["github-actions"]
}
__CONV_EOF__
mkdir -p "$(dirname 'profiles/node-web.json')"
cat > 'profiles/node-web.json' <<'__CONV_EOF__'
{
  "description": "Node.js web app (Next.js, Astro, Vite, React)",
  "commands": {
    "install": "npm ci",
    "lint": "npm run lint",
    "typecheck": "npx tsc --noEmit",
    "test": "npm test",
    "build": "npm run build",
    "audit": "npm audit --audit-level=high"
  },
  "dependabot": ["npm", "github-actions"]
}
__CONV_EOF__
mkdir -p "$(dirname 'profiles/node-worker.json')"
cat > 'profiles/node-worker.json' <<'__CONV_EOF__'
{
  "description": "Cloudflare Worker or other Node.js service deployed with Wrangler",
  "commands": {
    "install": "npm ci",
    "lint": "npm run lint",
    "typecheck": "npx tsc --noEmit",
    "test": "npm test",
    "build": "npx wrangler deploy --dry-run",
    "audit": "npm audit --audit-level=high"
  },
  "dependabot": ["npm", "github-actions"]
}
__CONV_EOF__
mkdir -p "$(dirname 'profiles/python.json')"
cat > 'profiles/python.json' <<'__CONV_EOF__'
{
  "description": "Python project managed with uv",
  "commands": {
    "install": "uv sync",
    "lint": "uv run ruff check .",
    "typecheck": "uv run mypy .",
    "test": "uv run pytest",
    "build": "uv build",
    "audit": "uvx pip-audit"
  },
  "dependabot": ["uv", "github-actions"]
}
__CONV_EOF__
mkdir -p "$(dirname 'scripts/cloud-setup.sh')"
cat > 'scripts/cloud-setup.sh' <<'__CONV_EOF__'
#!/bin/bash
# Claude Code cloud environment setup script: installs global agent rules and shared skills.
# Usage (environment "Setup script" field):
#   curl -fsSL https://raw.githubusercontent.com/boycepoleonjr/conventions/v1/scripts/cloud-setup.sh | CONVENTIONS_REF=v1 bash || true
# Always exits 0 so a network hiccup never blocks a session.
REF="${CONVENTIONS_REF:-v1}"
DIR=/tmp/conventions
LOG="$HOME/.claude/.conventions-setup.log"
mkdir -p "$HOME/.claude/skills"
{
  echo "conventions setup $(date -u +%FT%TZ) ref=$REF"
  rm -rf "$DIR"
  if git clone --depth 1 --branch "$REF" https://github.com/boycepoleonjr/conventions "$DIR"; then
    cp "$DIR/global/CLAUDE.md" "$HOME/.claude/CLAUDE.md" && echo "installed ~/.claude/CLAUDE.md"
    for s in "$DIR"/skills/*/; do
      n=$(basename "$s"); mkdir -p "$HOME/.claude/skills/$n"; cp "$s"SKILL.md "$HOME/.claude/skills/$n/SKILL.md" && echo "installed skill $n"
    done
    echo "version $(cat "$DIR/VERSION") commit $(git -C "$DIR" rev-parse --short HEAD)"
  else
    echo "clone failed"
  fi
} >> "$LOG" 2>&1
exit 0
__CONV_EOF__
mkdir -p "$(dirname 'scripts/sync.mjs')"
cat > 'scripts/sync.mjs' <<'__CONV_EOF__'
#!/usr/bin/env node
// Apply boycepoleonjr/conventions to a repository. Node 20+, no dependencies.
//
//   node sync.mjs --repo <path> --init [--profile <name>] [--name <project name>]
//   node sync.mjs --repo <path>            apply the checked-out conventions version
//   node sync.mjs --repo <path> --check    report only; exit 1 if anything would change
//   node sync.mjs --repo <path> --force    overwrite managed files edited by hand
//
// Exit codes: 0 ok, 1 drift found (--check), 2 conflicts left unresolved, 3 usage error.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = ".conventions.json";
const LOCK = ".conventions.lock.json";
const BLOCK_RE = /<!-- conventions:begin (\S+) -->\n?([\s\S]*?)<!-- conventions:end \1 -->/g;

function parseArgs(argv) {
  const a = { repo: process.cwd(), init: false, check: false, force: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--repo") a.repo = path.resolve(argv[++i]);
    else if (k === "--init") a.init = true;
    else if (k === "--check") a.check = true;
    else if (k === "--force") a.force = true;
    else if (k === "--profile") a.profile = argv[++i];
    else if (k === "--name") a.name = argv[++i];
    else if (k === "-h" || k === "--help") a.help = true;
    else throw new Error(`unknown argument ${k}`);
  }
  return a;
}

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);
const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null);
const readJson = (p) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null);
const sortKeys = (o) =>
  Array.isArray(o) || o === null || typeof o !== "object"
    ? o
    : Object.fromEntries(Object.keys(o).sort().map((k) => [k, sortKeys(o[k])]));
const toJson = (o) => JSON.stringify(sortKeys(o), null, 2) + "\n";

function detect(repo, a) {
  const has = (f) => fs.existsSync(path.join(repo, f));
  const pkg = readJson(path.join(repo, "package.json"));
  let profile = a.profile;
  if (!profile) {
    if (has("pyproject.toml")) profile = "python";
    else if (pkg && (has("wrangler.toml") || has("wrangler.jsonc") || has("wrangler.json"))) profile = "node-worker";
    else if (pkg) profile = "node-web";
    else profile = "generic";
  }
  const prof = loadProfile(profile);
  const commands = { ...prof.commands };
  if (pkg) {
    const scripts = pkg.scripts || {};
    const pm = has("pnpm-lock.yaml") ? "pnpm" : has("yarn.lock") ? "yarn" : has("bun.lockb") || has("bun.lock") ? "bun" : "npm";
    const run = (s) => (pm === "npm" ? `npm run ${s}` : `${pm} ${s}`);
    commands.install = { npm: "npm ci", pnpm: "pnpm install --frozen-lockfile", yarn: "yarn install --frozen-lockfile", bun: "bun install --frozen-lockfile" }[pm];
    commands.lint = scripts.lint ? run("lint") : "";
    commands.typecheck = scripts.typecheck ? run("typecheck") : has("tsconfig.json") ? `${pm === "npm" ? "npx" : pm === "bun" ? "bunx" : pm + " exec"} tsc --noEmit` : "";
    commands.test = scripts.test ? (pm === "npm" ? "npm test" : run("test")) : "";
    if (scripts.build) commands.build = run("build");
    else if (profile !== "node-worker") commands.build = "";
    commands.audit = { npm: "npm audit --audit-level=high", pnpm: "pnpm audit --audit-level high", yarn: "yarn npm audit --severity high", bun: "" }[pm];
  }
  const name = a.name || (pkg && pkg.name) || path.basename(repo);
  return { profile, project: { name, summary: "TODO: one paragraph on what this project is and who it serves." }, commands, skip: [] };
}

function loadProfile(name) {
  const p = readJson(path.join(ROOT, "profiles", `${name}.json`));
  if (!p) throw new Error(`unknown profile "${name}" (see profiles/)`);
  return p;
}

function vars(cfg, version) {
  const prof = loadProfile(cfg.profile);
  const commands = { ...prof.commands, ...(cfg.commands || {}) };
  const listed = Object.entries(commands).filter(([, v]) => v);
  const commands_list = listed.length ? listed.map(([k, v]) => `- ${k}: \`${v}\``).join("\n") : "- TODO: add commands to .conventions.json";
  const ecos = cfg.dependabot || prof.dependabot;
  const dependabot_updates = ecos
    .map((e) => `  - package-ecosystem: "${e}"\n    directory: "/"\n    schedule:\n      interval: "weekly"\n    open-pull-requests-limit: 5`)
    .join("\n");
  return { project: cfg.project || {}, commands, conventions: { version }, profile: cfg.profile, commands_list, dependabot_updates };
}

function render(tpl, v) {
  return tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, key) => {
    const val = key.split(".").reduce((o, k) => (o == null ? undefined : o[k]), v);
    if (val === undefined) throw new Error(`template variable {{${key}}} is undefined`);
    return String(val);
  });
}

function blocksOf(text) {
  const out = new Map();
  for (const m of text.matchAll(BLOCK_RE)) out.set(m[1], m[2]);
  return out;
}
const blockText = (id, body) => `<!-- conventions:begin ${id} -->\n${body}<!-- conventions:end ${id} -->`;
const managedHash = (blocks, ids) => sha(ids.map((id) => `${id}\n${blocks.get(id) ?? ""}`).join("\n"));

function applyBlocks(current, desired, ids) {
  let text = current;
  const have = blocksOf(text);
  let prevId = null;
  for (const id of ids) {
    const body = desired.get(id);
    if (have.has(id)) {
      text = text.replace(new RegExp(`<!-- conventions:begin ${id} -->\\n?[\\s\\S]*?<!-- conventions:end ${id} -->`), () => blockText(id, body));
    } else if (body.trim() && text.includes(body.trim())) {
      // Retrofit: the repo already has this exact content unmarked; wrap it instead of duplicating.
      const t = body.trim();
      const end = text.indexOf(t) + t.length;
      const after = text[end] === "\n" ? end + 1 : end;
      text = text.slice(0, text.indexOf(t)) + blockText(id, body) + "\n" + text.slice(after);
    } else if (prevId && text.includes(`<!-- conventions:end ${prevId} -->`)) {
      const end = `<!-- conventions:end ${prevId} -->`;
      text = text.replace(end, () => `${end}\n\n${blockText(id, body)}`);
    } else {
      const lines = text.split("\n");
      const h1 = lines.findIndex((l) => /^# /.test(l));
      if (h1 >= 0) lines.splice(h1 + 1, 0, "", blockText(id, body));
      else lines.unshift(blockText(id, body), "");
      text = lines.join("\n");
    }
    prevId = id;
  }
  return text;
}

export function plan(repo, opts = {}) {
  const version = fs.readFileSync(path.join(ROOT, "VERSION"), "utf8").trim();
  const manifest = readJson(path.join(ROOT, "manifest.json"));
  const cfgPath = path.join(repo, CONFIG);
  let cfg = readJson(cfgPath);
  const actions = [];
  if (!cfg) {
    if (!opts.init) throw new Error(`${CONFIG} not found in ${repo}. Run with --init first.`);
    cfg = detect(repo, opts);
    actions.push({ status: "CREATE", dest: CONFIG, content: toJson(cfg) });
  }
  const lock = readJson(path.join(repo, LOCK)) || { version: null, files: {} };
  const v = vars(cfg, version);
  const skip = new Set(cfg.skip || []);
  const newLock = { version, profile: cfg.profile, files: {} };

  for (const f of manifest.files) {
    if (skip.has(f.id)) { actions.push({ status: "SKIP", dest: f.dest, note: `"${f.id}" in skip` }); continue; }
    if (f.profiles && !f.profiles.includes(cfg.profile)) continue;
    const dest = path.join(repo, f.dest);
    const desired = render(fs.readFileSync(path.join(ROOT, f.src), "utf8"), v);
    const current = read(dest);
    const prevHash = lock.files[f.dest];

    if (f.mode === "seed") {
      actions.push(current === null ? { status: "CREATE", dest: f.dest, content: desired } : { status: "OK", dest: f.dest, note: "seed exists" });
      continue;
    }
    if (f.mode === "replace") {
      const want = sha(desired);
      if (current === null) { actions.push({ status: "CREATE", dest: f.dest, content: desired }); newLock.files[f.dest] = want; continue; }
      const have = sha(current);
      if (have === want) { actions.push({ status: "OK", dest: f.dest }); newLock.files[f.dest] = want; continue; }
      if (prevHash && have === prevHash) { actions.push({ status: "UPDATE", dest: f.dest, content: desired }); newLock.files[f.dest] = want; continue; }
      if (opts.force) { actions.push({ status: "UPDATE", dest: f.dest, content: desired, note: "forced" }); newLock.files[f.dest] = want; continue; }
      actions.push({ status: "CONFLICT", dest: f.dest, note: prevHash ? "edited by hand since last sync" : "file exists and is not managed yet; merge by hand, add to skip, or --force" });
      if (prevHash) newLock.files[f.dest] = prevHash;
      continue;
    }
    if (f.mode === "block") {
      const desiredBlocks = blocksOf(desired);
      for (const id of f.blocks) if (!desiredBlocks.has(id)) throw new Error(`template ${f.src} is missing block ${id}`);
      const want = managedHash(desiredBlocks, f.blocks);
      if (current === null) { actions.push({ status: "CREATE", dest: f.dest, content: desired }); newLock.files[f.dest] = want; continue; }
      const curBlocks = blocksOf(current);
      const have = managedHash(curBlocks, f.blocks);
      if (have === want) { actions.push({ status: "OK", dest: f.dest }); newLock.files[f.dest] = want; continue; }
      const allPresent = f.blocks.every((id) => curBlocks.has(id));
      if (allPresent && prevHash && have !== prevHash && !opts.force) {
        actions.push({ status: "CONFLICT", dest: f.dest, note: "a managed block was edited by hand since last sync" });
        newLock.files[f.dest] = prevHash;
        continue;
      }
      const missing = f.blocks.filter((id) => !curBlocks.has(id));
      actions.push({ status: "UPDATE", dest: f.dest, content: applyBlocks(current, desiredBlocks, f.blocks), note: missing.length ? `inserted ${missing.join(", ")}` : "blocks updated" });
      newLock.files[f.dest] = want;
      continue;
    }
    throw new Error(`unknown mode ${f.mode} for ${f.id}`);
  }

  const lockText = toJson(newLock);
  if (read(path.join(repo, LOCK)) !== lockText) actions.push({ status: lock.version ? "UPDATE" : "CREATE", dest: LOCK, content: lockText, note: lock.version && lock.version !== version ? `v${lock.version} -> v${version}` : undefined });
  return { version, from: lock.version, actions };
}

export function apply(repo, result) {
  for (const a of result.actions) {
    if (a.content === undefined || !["CREATE", "UPDATE"].includes(a.status)) continue;
    const p = path.join(repo, a.dest);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, a.content);
  }
}

function main() {
  let a;
  try { a = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(3); }
  if (a.help) { console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 9).join("\n")); return; }
  let result;
  try { result = plan(a.repo, a); } catch (e) { console.error(`error: ${e.message}`); process.exit(3); }
  const changes = result.actions.filter((x) => x.status === "CREATE" || x.status === "UPDATE");
  const conflicts = result.actions.filter((x) => x.status === "CONFLICT");
  console.log(`conventions v${result.version} -> ${a.repo}${result.from ? ` (last synced v${result.from})` : ""}${a.check ? " [check]" : ""}`);
  for (const x of result.actions) console.log(`${x.status.padEnd(8)} ${x.dest}${x.note ? `  (${x.note})` : ""}`);
  console.log(`summary: ${changes.length} to write, ${conflicts.length} conflicts`);
  if (a.check) process.exit(changes.length || conflicts.length ? 1 : 0);
  apply(a.repo, result);
  process.exit(conflicts.length ? 2 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
__CONV_EOF__
mkdir -p "$(dirname 'skills/dependency-update/SKILL.md')"
cat > 'skills/dependency-update/SKILL.md' <<'__CONV_EOF__'
---
name: dependency-update
description: Use when updating dependencies or clearing npm/pip audit findings. Prefers the smallest safe change and declares every version change openly.
---

# Dependency update

1. Record the audit before: counts by severity, using the exact command from CI.
2. Try non-breaking fixes first: `npm audit fix` (or the ecosystem equivalent), patch and minor bumps.
3. Major bumps of direct dependencies only when required to pass the gate. Explain each one in the PR.
4. Declare changes openly in the manifest. If you must downgrade or pin a package, change its declared range in `package.json` (or equivalent) so the manifest tells the truth. Use `overrides`/`resolutions` only for transitive packages you cannot reach otherwise, and explain each override in the PR.
5. Regenerate the lockfile with the repo's own package manager. Never add a second lockfile.
6. Verify with a clean install, the audit command, lint, typecheck, tests and build. Report the audit after, and list every version change.
__CONV_EOF__
mkdir -p "$(dirname 'skills/fix-with-regression-tests/SKILL.md')"
cat > 'skills/fix-with-regression-tests/SKILL.md' <<'__CONV_EOF__'
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
__CONV_EOF__
mkdir -p "$(dirname 'skills/open-pr/SKILL.md')"
cat > 'skills/open-pr/SKILL.md' <<'__CONV_EOF__'
---
name: open-pr
description: Use before opening or marking ready any pull request. Runs the repo's checks, writes the PR description from the template, and decides draft vs ready.
---

# Open a PR

1. Confirm the branch is `<type>/<slug>` off the right base, and the diff contains only this task's changes.
2. Run every command in the Commands block of `AGENTS.md`. Record the real exit code of each. Fix failures you caused; note pre-existing failures with evidence (the same check failing on the base branch).
3. Open the PR as a **draft** after the first commit.
4. Fill `.github/pull_request_template.md`: what, why, the checks table with real results, risk, and decisions needed.
5. Mark it **ready for review** only when every command passes and CI is green. Never merge.
6. Write or update `docs/handoffs/YYYY-MM-DD-<topic>.md` if the work spans sessions.
__CONV_EOF__
mkdir -p "$(dirname 'templates/AGENTS.md')"
cat > 'templates/AGENTS.md' <<'__CONV_EOF__'
# AGENTS.md: {{project.name}}

Instructions for any coding agent (Claude Code, Cursor, Codex) and for people working in this repo. The blocks between `conventions` markers are synced from https://github.com/boycepoleonjr/conventions; edit everything else here.

<!-- conventions:begin agents-core -->
## Shared rules (conventions v{{conventions.version}})
- Read this file, the README, `package.json` or equivalent, and `.github/workflows/` before changing code. Use the repo's real commands.
- One branch per task (`<type>/<slug>`), Conventional Commits, minimal diffs: no refactors or unrelated edits in a fix PR.
- Open a draft PR after the first commit. Mark it ready for review only when every command below passes and CI is green; AI reviews trigger on ready. Never merge.
- PR description follows `.github/pull_request_template.md`: what, why, every command run with its real pass/fail, risk, and decisions needed.
- Bug fixes add regression tests for every path of the fix (empty, invalid, valid input, and any guard you add), not just the reported repro. See `.claude/skills/fix-with-regression-tests`.
- Dependency changes are declared openly in the manifest. Never hide a version change in `overrides` or `resolutions` while the manifest claims a different range. See `.claude/skills/dependency-update`.
- Non-trivial work gets a plan in `docs/specs/` first. End each session with a handoff in `docs/handoffs/YYYY-MM-DD-<topic>.md`.
- Never commit secrets, real customer data or `.env` files. Use synthetic data in tests and fixtures.
- Standard: https://github.com/boycepoleonjr/conventions/blob/v{{conventions.version}}/STANDARD.md
<!-- conventions:end agents-core -->

## Project
{{project.summary}}

- Stack: TODO
- Hosting and deploy: TODO
- Default branch and protection: TODO

<!-- conventions:begin agents-commands -->
## Commands
Run all of these before marking a PR ready, and report each with pass/fail:

{{commands_list}}
<!-- conventions:end agents-commands -->

## Repo rules
Repo-specific rules and known issues go here. They override the shared rules where they conflict.
__CONV_EOF__
mkdir -p "$(dirname 'templates/CLAUDE.md')"
cat > 'templates/CLAUDE.md' <<'__CONV_EOF__'
<!-- conventions:begin claude-import -->
@AGENTS.md
<!-- conventions:end claude-import -->
__CONV_EOF__
mkdir -p "$(dirname 'templates/conventions-check.yml')"
cat > 'templates/conventions-check.yml' <<'__CONV_EOF__'
# Synced from boycepoleonjr/conventions v{{conventions.version}}.
# Weekly report: is this repo behind the latest conventions, or edited by hand? Never fails required checks.
name: Conventions check
on:
  schedule:
    - cron: "17 13 * * 1"
  workflow_dispatch:
permissions:
  contents: read
jobs:
  drift:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0
        with:
          node-version: 22
      - name: Fetch pinned conventions
        run: |
          REF=$(node -p "'v' + require('./.conventions.lock.json').version")
          git clone --depth 1 --branch "$REF" https://github.com/boycepoleonjr/conventions /tmp/conventions
          LATEST=$(git ls-remote --tags --refs https://github.com/boycepoleonjr/conventions 'v*' | sed 's#.*refs/tags/##' | sort -V | tail -1)
          echo "Pinned: $REF  Latest: $LATEST" >> "$GITHUB_STEP_SUMMARY"
      - name: Drift report
        run: node /tmp/conventions/scripts/sync.mjs --repo . --check | tee -a "$GITHUB_STEP_SUMMARY" || echo "::warning::Conventions drift found; see summary"
__CONV_EOF__
mkdir -p "$(dirname 'templates/dependabot.yml')"
cat > 'templates/dependabot.yml' <<'__CONV_EOF__'
# Synced from boycepoleonjr/conventions v{{conventions.version}}. Edit there, or add "dependabot" to "skip" in .conventions.json.
version: 2
updates:
{{dependabot_updates}}
__CONV_EOF__
mkdir -p "$(dirname 'templates/handoffs-README.md')"
cat > 'templates/handoffs-README.md' <<'__CONV_EOF__'
# Handoffs

One note per working session: `YYYY-MM-DD-<topic>.md`. Say what state the work is in, what's left, open decisions, and exactly how to resume (branch, commands, links).
__CONV_EOF__
mkdir -p "$(dirname 'templates/pull_request_template.md')"
cat > 'templates/pull_request_template.md' <<'__CONV_EOF__'
<!-- Synced from boycepoleonjr/conventions v{{conventions.version}}. Edit there, not here. -->
## What
<!-- One or two sentences. Link the issue or spec. -->

## Why

## Checks
| Command | Result |
|---|---|
| lint | |
| typecheck | |
| tests | |
| build | |
| audit | |

## Risk
<!-- low / medium / high, and what could break: auth, data, deploy, dependencies, public pages -->

## Needs a decision
<!-- Anything the reviewer must decide before merge. "None" if nothing. -->
__CONV_EOF__
mkdir -p "$(dirname 'templates/specs-README.md')"
cat > 'templates/specs-README.md' <<'__CONV_EOF__'
# Specs

Plans for non-trivial work, written before code. One file per change: `YYYY-MM-DD-<topic>.md` with goal, non-goals, acceptance criteria, approach, risks and test plan.
__CONV_EOF__
mkdir -p "$(dirname 'test/sync.test.mjs')"
cat > 'test/sync.test.mjs' <<'__CONV_EOF__'
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
__CONV_EOF__
chmod +x scripts/cloud-setup.sh scripts/sync.mjs
echo "bootstrap wrote $(find . -type f -not -path "./.git/*" | wc -l) files"
