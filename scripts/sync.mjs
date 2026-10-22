#!/usr/bin/env node
// Apply boycepoleonjr/conventions to a repository. Node 20+, no dependencies.
//
//   node sync.mjs --repo <path> --init [--profile <name>] [--name <project name>]
//   node sync.mjs --repo <path>            apply the checked-out conventions version
//   node sync.mjs --repo <path> --check    report only; exit 1 if anything would change
//   node sync.mjs --repo <path> --force    overwrite managed files edited by hand
//   node sync.mjs --repo <path> --only <id>[,<id>...]   limit any of the above to the listed manifest ids
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
    else if (k === "--only") {
      const v = argv[++i];
      if (!v) throw new Error("--only needs a comma-separated list of manifest ids");
      a.only = v.split(",").map((x) => x.trim()).filter(Boolean);
      if (!a.only.length) throw new Error("--only needs a comma-separated list of manifest ids");
    }
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

// actions/checkout stays at v4.4.0 (v6+ persists the token through includeIf.gitdir, which claude-code-action does not clear).
const CHECKOUT_IGNORE = `    # Checkout is held at v4.4.0 on purpose (see the Claude workflows).\n    ignore:\n      - dependency-name: "actions/checkout"\n        update-types: ["version-update:semver-major"]\n`;

function vars(cfg, version) {
  const prof = loadProfile(cfg.profile);
  const commands = { ...prof.commands, ...(cfg.commands || {}) };
  const listed = Object.entries(commands).filter(([, v]) => v);
  const commands_list = listed.length ? listed.map(([k, v]) => `- ${k}: \`${v}\``).join("\n") : "- TODO: add commands to .conventions.json";
  const ecos = cfg.dependabot || prof.dependabot;
  const dependabot_updates = ecos
    .map((e) => `  - package-ecosystem: "${e}"\n    directory: "/"\n    schedule:\n      interval: "weekly"\n    open-pull-requests-limit: 5\n${e === "github-actions" ? CHECKOUT_IGNORE : ""}    groups:\n      minor-and-patch:\n        applies-to: version-updates\n        update-types: ["minor", "patch"]\n      major:\n        applies-to: version-updates\n        update-types: ["major"]`)
    .join("\n");
  return { project: cfg.project || {}, commands, conventions: { version }, profile: cfg.profile, commands_list, dependabot_updates, claude_review_focus: reviewFocus(cfg) };
}

// Extra lines for the Claude review prompt, indented to sit inside the workflow's `prompt: |` block scalar.
function reviewFocus(cfg) {
  const focus = String((cfg.claude_review && cfg.claude_review.focus) || "").replace(/\r\n?/g, "\n").trim();
  if (!focus) return "";
  if (focus.includes("${{")) throw new Error('claude_review.focus must not contain "${{" (GitHub expressions)');
  const pad = " ".repeat(12);
  return `\n${pad}Repo-specific focus:\n` + focus.split("\n").map((l) => (l.trim() ? pad + l : "")).join("\n");
}

// Only `{{ word.word }}` is ours; `${{ ... }}` is a GitHub Actions expression and passes through untouched.
// A placeholder alone on its line that renders empty drops the whole line.
function render(tpl, v) {
  const lookup = (key) => {
    const val = key.split(".").reduce((o, k) => (o == null ? undefined : o[k]), v);
    if (val === undefined) throw new Error(`template variable {{${key}}} is undefined`);
    return String(val);
  };
  return tpl
    .replace(/^(?<!\$)\{\{\s*([\w.]+)\s*\}\}\n/gm, (m, key) => (lookup(key) === "" ? "" : m))
    .replace(/(?<!\$)\{\{\s*([\w.]+)\s*\}\}/g, (m, key) => lookup(key));
}

function blocksOf(text) {
  const out = new Map();
  for (const m of text.matchAll(BLOCK_RE)) out.set(m[1], m[2]);
  return out;
}
const blockText = (id, body) => `<!-- conventions:begin ${id} -->\n${body}<!-- conventions:end ${id} -->`;
const managedHash = (blocks, ids) => sha(ids.map((id) => `${id}\n${blocks.get(id) ?? ""}`).join("\n"));

// Replace text[start, end) with `blk`, leaving exactly one blank line on each side (Prettier-clean markdown).
function spliceBlock(text, start, end, blk) {
  const before = text.slice(0, start).replace(/\n+$/, "");
  const after = text.slice(end).replace(/^\n+/, "");
  return (before ? before + "\n\n" : "") + blk + (after ? "\n\n" + after : "\n");
}

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
      const start = text.indexOf(t);
      text = spliceBlock(text, start, start + t.length, blockText(id, body));
    } else if (prevId && text.includes(`<!-- conventions:end ${prevId} -->`)) {
      const end = `<!-- conventions:end ${prevId} -->`;
      text = text.replace(end, () => `${end}\n\n${blockText(id, body)}`);
    } else {
      const lines = text.split("\n");
      const h1 = lines.findIndex((l) => /^# /.test(l));
      if (h1 >= 0) {
        const idx = lines.slice(0, h1 + 1).join("\n").length + 1;
        text = spliceBlock(text, Math.min(idx, text.length), Math.min(idx, text.length), blockText(id, body));
      } else text = spliceBlock(text, 0, 0, blockText(id, body));
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
  const only = opts.only ? new Set(opts.only) : null;
  if (only) {
    const unknown = [...only].filter((id) => !manifest.files.some((f) => f.id === id));
    if (unknown.length) throw new Error(`--only: unknown manifest id ${unknown.join(", ")} (known: ${manifest.files.map((f) => f.id).join(", ")})`);
  }
  // With --only, hashes of files outside the selection are carried over so a later full sync still knows them.
  const newLock = { version, profile: cfg.profile, files: only ? { ...lock.files } : {} };

  for (const f of manifest.files) {
    if (only && !only.has(f.id)) continue;
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
