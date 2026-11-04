// node --test test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// SUP-1/SUP-7: the pin form is fixed (full commit SHA plus a version comment); the version is only a seed.
const SETUP_NODE_RE = /uses: (actions\/setup-node@[0-9a-f]{40} # v\d+\.\d+\.\d+)\n/;
const CHECKOUT_RE = /uses: actions\/checkout@[0-9a-f]{40} # v\d+\.\d+\.\d+\n {8}with:\n {10}persist-credentials: false\n/;
// Every synced template that installs Node.
const TEMPLATES = ["templates/conventions-check.yml", "templates/deploy-secrets-lint.yml", "templates/conventions-sync-check.yml"];

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
// The seed the templates carry today, whatever its version.
const SETUP_NODE = read(TEMPLATES[0]).match(SETUP_NODE_RE)[1];

test("every template that sets up Node pins setup-node by full SHA with a version comment, all to the same seed", () => {
  for (const rel of TEMPLATES) {
    const text = read(rel);
    assert.match(text, SETUP_NODE_RE, `${rel} should pin setup-node by a 40-character SHA with a "# vX.Y.Z" comment`);
    assert.ok(text.includes(`uses: ${SETUP_NODE}`), `${rel} should carry the same setup-node seed as ${TEMPLATES[0]}`);
  }
});

test("no template pins setup-node by tag or by a short or moving ref (SUP-1)", () => {
  const dir = path.join(ROOT, "templates");
  for (const name of fs.readdirSync(dir).filter((n) => n.endsWith(".yml"))) {
    for (const m of fs.readFileSync(path.join(dir, name), "utf8").matchAll(/uses:\s*actions\/setup-node@(\S+)/g)) {
      assert.match(m[1], /^[0-9a-f]{40}$/, `${name}: setup-node must be pinned to a 40-character commit SHA, got ${m[1]}`);
    }
  }
});

test("a template that sets up Node is listed here, so a new one cannot keep an old pin", () => {
  const dir = path.join(ROOT, "templates");
  const withNode = fs.readdirSync(dir)
    .filter((n) => n.endsWith(".yml") && /actions\/setup-node@/.test(fs.readFileSync(path.join(dir, n), "utf8")))
    .map((n) => `templates/${n}`)
    .sort();
  assert.deepEqual(withNode, [...TEMPLATES].sort());
});

test("checkout is pinned by full SHA and sets persist-credentials: false (SUP-1, SUP-6)", () => {
  for (const rel of TEMPLATES) assert.match(read(rel), CHECKOUT_RE, `${rel}: checkout needs a SHA pin and persist-credentials: false`);
});

test("a new synced repo gets the setup-node seed in conventions-check.yml and deploy-secrets-lint.yml", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "pin-"));
  fs.writeFileSync(path.join(repo, "package.json"), JSON.stringify({ name: "demo", scripts: { test: "jest" } }));
  fs.writeFileSync(path.join(repo, "package-lock.json"), "{}");
  const run = (args) => spawnSync(process.execPath, [path.join(ROOT, "scripts/sync.mjs"), "--repo", repo, ...args], { encoding: "utf8" });
  const init = run(["--init"]);
  assert.equal(init.status, 0, init.stdout + init.stderr);
  for (const f of [".github/workflows/conventions-check.yml", ".github/workflows/deploy-secrets-lint.yml"]) {
    assert.ok(fs.readFileSync(path.join(repo, f), "utf8").includes(`uses: ${SETUP_NODE}`), `${f} should carry the seed`);
  }
  assert.equal(run(["--check"]).status, 0);
});

const sha = (text) => crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);
const OLD_PIN = "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0";
const REL = ".github/workflows/conventions-check.yml";

function syncedRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "pin-repo-"));
  fs.writeFileSync(path.join(repo, "package.json"), JSON.stringify({ name: "demo", scripts: { test: "jest" } }));
  fs.writeFileSync(path.join(repo, "package-lock.json"), "{}");
  const run = (args) => spawnSync(process.execPath, [path.join(ROOT, "scripts/sync.mjs"), "--repo", repo, ...args], { encoding: "utf8" });
  assert.equal(run(["--init"]).status, 0);
  return { repo, run, out: (r) => r.stdout + r.stderr };
}

test("a repo whose file differs only in its setup-node ref is OK, never an UPDATE or CONFLICT, and keeps its ref (SUP-7)", () => {
  const { repo, run, out } = syncedRepo();
  const file = path.join(repo, REL);
  const current = fs.readFileSync(file, "utf8");
  assert.ok(current.includes(SETUP_NODE));
  assert.notEqual(SETUP_NODE, OLD_PIN, "fixture needs a seed that differs from the old pin");
  // Same template, older setup-node ref, and a raw (pre-1.7.0) hash of that file in the lockfile.
  const old = current.replace(SETUP_NODE, OLD_PIN);
  fs.writeFileSync(file, old);
  const lockPath = path.join(repo, ".conventions.lock.json");
  const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  lock.files[REL] = sha(old);
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n");
  const res = run(["--check"]);
  assert.match(out(res), /OK\s+\.github\/workflows\/conventions-check\.yml\n/);
  assert.doesNotMatch(out(res), /CONFLICT|UPDATE\s+\.github\/workflows/);
  assert.equal(run([]).status, 0, "only the lock entry is rewritten to the normalized hash");
  assert.equal(fs.readFileSync(file, "utf8"), old, "sync neither upgrades nor downgrades the repo's ref");
  assert.equal(run(["--check"]).status, 0);
});

test("a bumped pin with a stale header and no lock entry is a CONFLICT; making it equal to the template is adopted", () => {
  const { repo, run, out } = syncedRepo();
  const file = path.join(repo, REL);
  const rendered = fs.readFileSync(file, "utf8");
  // A repo that skipped the file and let Dependabot bump the pin: same pin, older header, not in the lockfile.
  const stale = rendered.replace(/^# Synced from boycepoleonjr\/conventions v\S+\./m, "# Synced from boycepoleonjr/conventions v1.5.0.");
  assert.notEqual(stale, rendered);
  fs.writeFileSync(file, stale);
  const lockPath = path.join(repo, ".conventions.lock.json");
  const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  delete lock.files[REL];
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n");
  const conflict = run(["--check"]);
  assert.notEqual(conflict.status, 0);
  assert.match(out(conflict), /CONFLICT\s+\.github\/workflows\/conventions-check\.yml.*not managed yet/);
  // Editing only the header line to the template's own text is enough: no --force needed.
  fs.writeFileSync(file, rendered);
  const adopted = run([]);
  assert.equal(adopted.status, 0, out(adopted));
  assert.equal(run(["--check"]).status, 0);
});
