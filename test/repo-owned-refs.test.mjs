// node --test test/*.test.mjs
// SUP-7: version refs in synced workflows are repo-owned after the first write; SUP-1: they stay full commit SHAs.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { usesRefs, normalizeRefs, adoptRefs, isSha } from "../scripts/sync.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const write = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const readF = (dir, rel) => fs.readFileSync(path.join(dir, rel), "utf8");
const sha16 = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);
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

const MANIFEST = JSON.parse(readF(ROOT, "manifest.json"));
const WORKFLOWS = MANIFEST.files.filter((f) => f.refs === "repo");
const CR = ".github/workflows/claude-code-review.yml";
const CC = ".github/workflows/conventions-check.yml";
const DSL = ".github/workflows/deploy-secrets-lint.yml";

// What Dependabot does: new SHA and new version comment for one action, every occurrence.
const BUMPS = {
  "actions/checkout": ["c".repeat(40), "v7.0.1"],
  "actions/setup-node": ["d".repeat(40), "v6.1.0"],
  "anthropics/claude-code-action": ["e".repeat(40), "v1.0.300"],
};
function bump(text, bumps = BUMPS) {
  let t = text;
  for (const [action, [ref, ver]] of Object.entries(bumps)) {
    t = t.replace(new RegExp(`(uses: ${action.replace("/", "\\/")})@[0-9a-f]{40} # \\S+`, "g"), `$1@${ref} # ${ver}`);
  }
  return t;
}
function bumpAll(repo) {
  for (const f of [CR, CC, DSL]) write(repo, f, bump(readF(repo, f)));
}
const refsByAction = (text) => Object.fromEntries(usesRefs(text).map((u) => [u.action, `${u.ref}${u.comment}`]));

test("manifest: exactly the four synced workflows have repo-owned refs", () => {
  assert.deepEqual(WORKFLOWS.map((f) => f.id).sort(), ["claude-review", "conventions-check", "deploy-secrets-lint", "sync-check"]);
  for (const f of MANIFEST.files.filter((x) => x.refs !== "repo")) assert.ok(!("refs" in f), `${f.id} must not set refs`);
});

test("SUP-1 guard: every uses: ref in the templates is a full commit SHA with a version comment", () => {
  for (const f of fs.readdirSync(path.join(ROOT, "templates")).filter((n) => n.endsWith(".yml"))) {
    const text = readF(ROOT, `templates/${f}`);
    const lines = text.split("\n").filter((l) => /^\s*(-\s+)?uses:/.test(l));
    const refs = usesRefs(text);
    assert.equal(refs.length, lines.length, `${f}: every uses: line is a third-party action ref`);
    for (const u of refs) {
      assert.ok(isSha(u.ref), `${f}: ${u.action}@${u.ref} is not a 40-hex commit SHA`);
      assert.match(u.comment, /^ # v\d+(\.\d+)*$/, `${f}: ${u.action} needs a "# vX.Y.Z" version comment`);
    }
  }
});

test("SUP-6: every actions/checkout step in the synced workflows sets persist-credentials: false", () => {
  let n = 0;
  for (const f of WORKFLOWS) {
    const lines = readF(ROOT, f.src).split("\n");
    lines.forEach((l, i) => {
      if (!/uses: actions\/checkout@/.test(l)) return;
      n++;
      const indent = l.match(/^\s*(- )?/)[0].length;
      const rest = [];
      for (const x of lines.slice(i + 1)) {
        if (x.trim() && x.match(/^\s*/)[0].length < indent) break;
        if (/^\s*- /.test(x) && x.match(/^\s*/)[0].length <= indent - 2) break;
        rest.push(x);
      }
      assert.ok(rest.some((x) => /^\s+persist-credentials: false$/.test(x)), `${f.src}: checkout step without persist-credentials: false`);
    });
  }
  assert.equal(n, 4, "one checkout step per synced workflow");
});

test("no version hold anywhere: no ignore rule, no hold or cap wording in templates, profiles, scripts or STANDARD", () => {
  const repo = nodeRepo();
  assert.equal(sync(repo, ["--init"]).code, 0);
  assert.ok(!readF(repo, ".github/dependabot.yml").includes("ignore"));
  const files = ["STANDARD.md", ...["templates", "profiles", "scripts"].flatMap((d) => fs.readdirSync(path.join(ROOT, d)).map((n) => `${d}/${n}`))];
  for (const f of files) {
    const text = readF(ROOT, f);
    assert.ok(!/held at|is held|ignore:\s*\n\s*- dependency-name|CHECKOUT_IGNORE/i.test(text), `${f} holds a version`);
  }
});

test("new file: CREATE writes the template seed refs exactly", () => {
  const repo = nodeRepo();
  assert.equal(sync(repo, ["--init"]).code, 0);
  for (const f of WORKFLOWS) assert.deepEqual(refsByAction(readF(repo, f.dest)), refsByAction(readF(ROOT, f.src)), f.dest);
  assert.match(readF(repo, CC), /node-version: 22\n/);
});

test("Dependabot bumps after a sync: --check exits 0, apply and --force change nothing, nothing is downgraded", () => {
  const repo = nodeRepo();
  assert.equal(sync(repo, ["--init"]).code, 0);
  bumpAll(repo);
  write(repo, CC, readF(repo, CC).replace("node-version: 22", "node-version: 24"));
  const before = Object.fromEntries([CR, CC, DSL, ".conventions.lock.json"].map((f) => [f, readF(repo, f)]));
  const check = sync(repo, ["--check"]);
  assert.equal(check.code, 0, check.out);
  for (const f of [CR, CC, DSL]) assert.match(check.out, new RegExp(`OK\\s+${f.replace(/[./]/g, "\\$&")}\\n`));
  assert.doesNotMatch(check.out, /CONFLICT/);
  for (const args of [[], ["--force"]]) {
    const r = sync(repo, args);
    assert.equal(r.code, 0, r.out);
    for (const [f, text] of Object.entries(before)) assert.equal(readF(repo, f), text, `${args.join(" ")} rewrote ${f}`);
  }
  assert.match(readF(repo, CR), /actions\/checkout@c{40} # v7\.0\.1/);
  assert.match(readF(repo, DSL), /actions\/setup-node@d{40} # v6\.1\.0/);
});

test("template change in a new version: UPDATE keeps the repo refs and node-version, a new action gets the seed", () => {
  const repo = nodeRepo();
  assert.equal(sync(repo, ["--init"]).code, 0);
  bumpAll(repo);
  write(repo, CC, readF(repo, CC).replace("node-version: 22", "node-version: 24"));
  const conv = copyConventions();
  write(conv, "VERSION", "9.9.0\n");
  const NEW = `      - uses: actions/cache@${"f".repeat(40)} # v4.2.0\n        with:\n          path: ~/.npm\n          key: npm\n`;
  write(conv, "templates/conventions-check.yml", readF(conv, "templates/conventions-check.yml").replace("      - name: Fetch pinned conventions\n", `${NEW}      - name: Fetch pinned conventions\n`));
  write(conv, "templates/deploy-secrets-lint.yml", readF(conv, "templates/deploy-secrets-lint.yml").replace("name: Deploy secrets lint", "name: Deploy secrets lint (new)"));
  const check = sync(repo, ["--check"], conv);
  assert.equal(check.code, 1, check.out);
  assert.match(check.out, /UPDATE\s+\.github\/workflows\/conventions-check\.yml\s+\(repo action refs kept\)/);
  assert.match(check.out, /UPDATE\s+\.github\/workflows\/deploy-secrets-lint\.yml/);
  assert.match(check.out, /UPDATE\s+\.github\/workflows\/claude-code-review\.yml\s+\(repo action refs kept\)/, "version header changed");
  assert.doesNotMatch(check.out, /CONFLICT/);
  const r = sync(repo, [], conv);
  assert.equal(r.code, 0, r.out);
  const cc = readF(repo, CC);
  assert.ok(cc.includes(NEW), "new action written with its seed ref");
  assert.match(cc, /actions\/checkout@c{40} # v7\.0\.1\n {8}with:\n {10}persist-credentials: false/);
  assert.match(cc, /actions\/setup-node@d{40} # v6\.1\.0/);
  assert.match(cc, /node-version: 24\n/);
  assert.match(readF(repo, DSL), /name: Deploy secrets lint \(new\)/);
  assert.match(readF(repo, DSL), /actions\/setup-node@d{40} # v6\.1\.0/);
  assert.match(readF(repo, CR), /# Synced from boycepoleonjr\/conventions v9\.9\.0 /);
  assert.match(readF(repo, CR), /claude-code-action@e{40} # v1\.0\.300/);
  assert.equal(sync(repo, ["--check"], conv).code, 0);
});

test("hand edits outside the refs are still a CONFLICT; --force writes the template and keeps the repo refs", () => {
  const repo = nodeRepo();
  assert.equal(sync(repo, ["--init"]).code, 0);
  bumpAll(repo);
  write(repo, DSL, readF(repo, DSL).replace("--repo .", "--repo . --secret FLY_API_TOKEN"));
  const r = sync(repo);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /CONFLICT\s+\.github\/workflows\/deploy-secrets-lint\.yml\s+\(edited by hand since last sync\)/);
  assert.match(readF(repo, DSL), /FLY_API_TOKEN/);
  const f = sync(repo, ["--force"]);
  assert.equal(f.code, 0, f.out);
  assert.match(f.out, /UPDATE\s+\.github\/workflows\/deploy-secrets-lint\.yml\s+\(forced, repo action refs kept\)/);
  assert.doesNotMatch(readF(repo, DSL), /FLY_API_TOKEN/);
  assert.match(readF(repo, DSL), /actions\/checkout@c{40} # v7\.0\.1/);
  assert.equal(sync(repo, ["--check"]).code, 0);
});

test("SUP-1: a repo ref that is not a full SHA is drift, flagged, and never adopted", () => {
  const repo = nodeRepo();
  assert.equal(sync(repo, ["--init"]).code, 0);
  bumpAll(repo);
  write(repo, CC, readF(repo, CC).replace(/actions\/checkout@[0-9a-f]{40} # \S+/, "actions/checkout@v7"));
  const check = sync(repo, ["--check"]);
  assert.equal(check.code, 1, check.out);
  assert.match(check.out, /CONFLICT\s+\.github\/workflows\/conventions-check\.yml\s+\(edited by hand since last sync; actions\/checkout@v7 is not a full commit SHA \(SUP-1\), template seed used\)/);
  assert.equal(sync(repo, ["--force"]).code, 0);
  const cc = readF(repo, CC);
  const seed = refsByAction(readF(ROOT, "templates/conventions-check.yml"))["actions/checkout"];
  assert.ok(cc.includes(`actions/checkout@${seed}`), "seed restored for the non-SHA ref");
  assert.match(cc, /actions\/setup-node@d{40} # v6\.1\.0/, "other repo refs kept");
  assert.equal(sync(repo, ["--check"]).code, 0);
});

// A conventions copy that behaves like 1.6.2 for the workflows: no repo-owned refs (raw lock hashes), no persist-credentials.
function preV170() {
  const old = copyConventions();
  write(old, "VERSION", "1.6.2\n");
  const m = JSON.parse(readF(old, "manifest.json"));
  for (const f of m.files) delete f.refs;
  write(old, "manifest.json", JSON.stringify(m, null, 2));
  for (const f of WORKFLOWS) write(old, f.src, readF(old, f.src).replace(/\n\s+persist-credentials: false/, "").replace(/(uses: actions\/checkout@\S+ # \S+)\n {8}with:\n(?! {10})/, "$1\n"));
  return old;
}

test("upgrade from a pre-1.7.0 lock: an untouched repo gets a one-time UPDATE, refs unchanged, then clean", () => {
  const old = preV170();
  assert.doesNotMatch(readF(old, "templates/conventions-check.yml"), /persist-credentials|with:\n {6}- uses: actions\/setup-node/);
  const repo = nodeRepo();
  assert.equal(sync(repo, ["--init"], old).code, 0);
  const lock = JSON.parse(readF(repo, ".conventions.lock.json"));
  assert.equal(lock.files[CC], sha16(readF(repo, CC)), "fixture lock holds raw hashes");
  const refsBefore = Object.fromEntries([CR, CC, DSL].map((f) => [f, refsByAction(readF(repo, f))]));
  const check = sync(repo, ["--check"]);
  assert.equal(check.code, 1, check.out);
  for (const f of [CR, CC, DSL]) assert.match(check.out, new RegExp(`UPDATE\\s+${f.replace(/[./]/g, "\\$&")}`));
  assert.doesNotMatch(check.out, /CONFLICT/);
  assert.equal(sync(repo).code, 0);
  for (const f of [CR, CC, DSL]) {
    assert.match(readF(repo, f), /persist-credentials: false/);
    assert.deepEqual(refsByAction(readF(repo, f)), refsBefore[f], `${f} refs unchanged`);
  }
  assert.equal(sync(repo, ["--check"]).code, 0);
});

test("upgrade from a pre-1.7.0 lock after Dependabot bumped the refs: UPDATE, not CONFLICT, and no downgrade", () => {
  const old = preV170();
  const repo = nodeRepo();
  assert.equal(sync(repo, ["--init"], old).code, 0);
  bumpAll(repo);
  const check = sync(repo, ["--check"]);
  assert.equal(check.code, 1, check.out);
  assert.doesNotMatch(check.out, /CONFLICT/);
  const r = sync(repo);
  assert.equal(r.code, 0, r.out);
  for (const f of [CR, CC, DSL]) {
    assert.match(readF(repo, f), /actions\/checkout@c{40} # v7\.0\.1/, `${f} kept the bumped checkout`);
    assert.match(readF(repo, f), /persist-credentials: false/);
  }
  assert.match(readF(repo, CR), /claude-code-action@e{40} # v1\.0\.300/);
  assert.equal(sync(repo, ["--check"]).code, 0);
  // and a pre-1.7.0 hand edit outside the refs is still a conflict
  const repo2 = nodeRepo();
  assert.equal(sync(repo2, ["--init"], old).code, 0);
  write(repo2, DSL, bump(readF(repo2, DSL)).replace("--repo .", "--repo . --secret X"));
  assert.match(sync(repo2).out, /CONFLICT\s+\.github\/workflows\/deploy-secrets-lint\.yml/);
});

test("other managed files are unchanged: raw lock hashes, and a uses: line outside the workflows is not repo-owned", () => {
  const conv = copyConventions();
  const ref = "a".repeat(40);
  write(conv, "templates/pull_request_template.md", readF(conv, "templates/pull_request_template.md") + `\n<!-- uses: actions/checkout@${ref} # v4.4.0 -->\n`);
  const repo = nodeRepo();
  assert.equal(sync(repo, ["--init"], conv).code, 0);
  const lock = JSON.parse(readF(repo, ".conventions.lock.json"));
  for (const f of MANIFEST.files.filter((x) => x.mode === "replace" && x.refs !== "repo")) {
    assert.equal(lock.files[f.dest], sha16(readF(repo, f.dest)), `${f.dest}: raw hash`);
  }
  for (const f of WORKFLOWS) assert.equal(lock.files[f.dest], sha16(normalizeRefs(readF(repo, f.dest))), `${f.dest}: normalized hash`);
  write(repo, ".github/pull_request_template.md", readF(repo, ".github/pull_request_template.md").replace(ref, "b".repeat(40)));
  write(repo, ".github/dependabot.yml", readF(repo, ".github/dependabot.yml").replace('interval: "weekly"', 'interval: "daily"'));
  const r = sync(repo, [], conv);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /CONFLICT\s+\.github\/pull_request_template\.md\s+\(edited by hand since last sync\)\n/);
  assert.match(r.out, /CONFLICT\s+\.github\/dependabot\.yml\s+\(edited by hand since last sync\)\n/);
});

test("adoptRefs and normalizeRefs: matched by action and occurrence, comments carried, non-SHA refs left alone", () => {
  const A = "1".repeat(40), B = "2".repeat(40), C = "3".repeat(40), D = "4".repeat(40);
  const tpl = `steps:\n  - uses: o/a@${A} # v1.0.0\n  - uses: o/b/sub@${A} # v1.0.0\n  - uses: o/a@${A} # v1.0.0\n  - uses: o/new@${A} # v1.0.0\n  - uses: ./local\n    with:\n      node-version: 22\n  - uses: o/c@${A} # v1\n    with:\n      node-version: 20\n`;
  const repo = `steps:\n  - uses: o/a@${B} # v2.0.0\n  - uses: o/b/sub@${C}\n  - uses: o/c@v3\n    with:\n      node-version: 24\n`;
  const notes = [];
  const out = adoptRefs(tpl, repo, notes);
  assert.equal(out, `steps:\n  - uses: o/a@${B} # v2.0.0\n  - uses: o/b/sub@${C}\n  - uses: o/a@${B} # v2.0.0\n  - uses: o/new@${A} # v1.0.0\n  - uses: ./local\n    with:\n      node-version: 24\n  - uses: o/c@${A} # v1\n    with:\n      node-version: 20\n`);
  assert.deepEqual(notes, ["o/c@v3 is not a full commit SHA (SUP-1), template seed used"]);
  assert.equal(normalizeRefs(`  - uses: o/a@${D} # v9\n  - uses: o/a@v9\n    node-version: "lts/*"\n`), `  - uses: o/a@<sha>\n  - uses: o/a@v9\n    node-version: <repo>\n`);
  assert.equal(normalizeRefs(tpl), normalizeRefs(out.replace(`o/c@${A} # v1`, `o/c@${D} # v5`)));
  assert.equal(adoptRefs(tpl, ""), tpl, "nothing to adopt from an empty file");
});

test("a seed bump alone (same version) causes no UPDATE in a synced repo and only changes new files", () => {
  const repo = nodeRepo();
  assert.equal(sync(repo, ["--init"]).code, 0);
  const conv = copyConventions();
  for (const f of WORKFLOWS) write(conv, f.src, bump(readF(conv, f.src)));
  const check = sync(repo, ["--check"], conv);
  assert.equal(check.code, 0, check.out);
  assert.match(readF(repo, CC), /actions\/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4\.4\.0/, "existing file keeps its refs");
  const fresh = nodeRepo();
  assert.equal(sync(fresh, ["--init"], conv).code, 0);
  assert.match(readF(fresh, CC), /actions\/checkout@c{40} # v7\.0\.1/, "a new file gets the new seed");
});

test("edge case: a 1.6.2 lock with a Dependabot-bumped setup-node is a CONFLICT; one --force keeps the refs and adds the new template", () => {
  // 1.6.2 had setup-node v4.4.0 as its seed; 1.6.3 moved the seed, so the pre-1.7.0 seed-reset check cannot match.
  const old = preV170();
  const OLD = "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0";
  for (const f of ["templates/conventions-check.yml", "templates/deploy-secrets-lint.yml"]) {
    write(old, f, readF(old, f).replace(/actions\/setup-node@[0-9a-f]{40} # \S+/, OLD));
  }
  const repo = nodeRepo();
  assert.equal(sync(repo, ["--init"], old).code, 0);
  assert.ok(readF(repo, CC).includes(OLD), "fixture starts at the 1.6.2 seed");
  bumpAll(repo);
  const r = sync(repo);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /CONFLICT\s+\.github\/workflows\/conventions-check\.yml\s+\(edited by hand since last sync\)/);
  assert.match(r.out, /CONFLICT\s+\.github\/workflows\/deploy-secrets-lint\.yml\s+\(edited by hand since last sync\)/);
  assert.match(r.out, /UPDATE\s+\.github\/workflows\/claude-code-review\.yml/, "claude-review's seeds did not move, so it upgrades cleanly");
  const f = sync(repo, ["--force"]);
  assert.equal(f.code, 0, f.out);
  for (const p of [CC, DSL]) {
    const t = readF(repo, p);
    assert.match(t, /actions\/setup-node@d{40} # v6\.1\.0/, `${p}: bumped setup-node kept`);
    assert.match(t, /actions\/checkout@c{40} # v7\.0\.1\n {8}with:\n {10}persist-credentials: false/, `${p}: bumped checkout kept, template applied`);
  }
  assert.equal(sync(repo, ["--check"]).code, 0);
});
