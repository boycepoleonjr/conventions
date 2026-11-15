// node --test test/*.test.mjs
// v1.9.1: the attribution workflows and the sync check deny permissions by default (workflow-level `permissions: {}`)
// and grant scopes per job, so a job added later gets nothing until someone grants it.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

// [template, job id, the exact job-level scopes]
const EXPECTED = [
  ["templates/ai-attribution-scrub.yml", "scrub", ["contents: read", "issues: write", "pull-requests: write"]],
  ["templates/ai-attribution-check.yml", "check", ["contents: read", "pull-requests: read"]],
  ["templates/conventions-sync-check.yml", "sync-check", ["contents: read"]],
];

// The text of one job: from its `  id:` line to the next job or the end of the file.
function job(text, id) {
  const m = text.match(new RegExp(`^ {2}${id}:\\n((?: {4}.*\\n|\\n)+)`, "m"));
  assert.ok(m, `job ${id} exists`);
  return m[1];
}

for (const [file, id, scopes] of EXPECTED) {
  test(`${file}: workflow-level permissions are empty, the job grants exactly ${scopes.join(", ")}`, () => {
    const text = read(file);
    assert.equal([...text.matchAll(/^permissions:/gm)].length, 1, "one workflow-level permissions key");
    assert.match(text, /^permissions: \{\}$/m, "workflow level is deny-by-default");
    const body = job(text, id);
    const block = body.match(/^ {4}permissions:\n((?: {6}\S.*\n)+)/m);
    assert.ok(block, "the job has its own permissions block");
    assert.deepEqual(block[1].split("\n").filter(Boolean).map((l) => l.trim()), scopes);
    assert.ok(!/^ {4}permissions:\s*(read-all|write-all)/m.test(body));
  });

  test(`${file}: every job has its own permissions block`, () => {
    const text = read(file);
    const jobs = [...text.split(/^jobs:\n/m)[1].matchAll(/^ {2}([A-Za-z0-9_-]+):\n/gm)].map((m) => m[1]);
    assert.deepEqual(jobs, [id], "the workflow has the one job");
    for (const j of jobs) assert.match(job(text, j), /^ {4}permissions:\n/m, `${j} grants its own scopes`);
  });
}

test("workflow-level permissions are not widened anywhere in the three templates", () => {
  for (const [file] of EXPECTED) {
    const top = read(file).split(/^jobs:/m)[0];
    assert.ok(!/^permissions:\n/m.test(top), `${file}: no scopes at the top level`);
    assert.ok(!/:\s*write\b/.test(top.replace(/^#.*$/gm, "")), `${file}: no write scope above jobs`);
  }
});
