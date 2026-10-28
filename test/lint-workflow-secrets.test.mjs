// node --test test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { lintWorkflow } from "../scripts/lint-workflow-secrets.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(ROOT, "scripts/lint-workflow-secrets.mjs");

const good = `name: deploy
on:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: production
    steps:
      - run: npx wrangler deploy
        env:
          CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}
`;
const without = (text, needle) => {
  assert.ok(text.includes(needle), `fixture lost ${needle}`);
  return text.replace(needle, "");
};
const wheres = (text, pattern) => lintWorkflow(text, pattern).map((p) => p.where);

test("a job with an environment passes", () => {
  assert.deepEqual(lintWorkflow(good), []);
});

test("environment as a one-liner passes", () => {
  assert.deepEqual(lintWorkflow(good.replace("    environment:\n      name: production\n", "    environment: production\n")), []);
});

test("a job without an environment fails", () => {
  assert.deepEqual(wheres(without(good, "    environment:\n      name: production\n")), ["job deploy"]);
});

test("account id is covered too, not only the token", () => {
  const bad = without(good, "    environment:\n      name: production\n").replace("CLOUDFLARE_API_TOKEN }}", "CLOUDFLARE_ACCOUNT_ID }}");
  assert.deepEqual(wheres(bad), ["job deploy"]);
});

test("only the unprotected job is reported", () => {
  const two = `${good}  other:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n        env:\n          T: \${{ secrets.CLOUDFLARE_API_TOKEN }}\n`;
  assert.deepEqual(wheres(two), ["job other"]);
});

test("a secret above jobs: (workflow-level env) fails", () => {
  const bad = good.replace("permissions:", "env:\n  T: ${{ secrets.CLOUDFLARE_API_TOKEN }}\npermissions:");
  assert.deepEqual(wheres(bad), ["workflow level"]);
});

test("pull_request_target plus the secret fails, even with an environment", () => {
  const bad = good.replace("  push:\n    branches: [main]", "  pull_request_target:");
  assert.deepEqual(wheres(bad), ["workflow"]);
  // without the secret the trigger alone is not this rule's business
  assert.deepEqual(lintWorkflow(bad.replace("secrets.CLOUDFLARE_API_TOKEN", "secrets.OTHER")), []);
});

test("secrets: inherit into an external reusable workflow fails; into a local one is left to that workflow's own lint", () => {
  const external = `on: push\njobs:\n  call:\n    uses: some-org/shared/.github/workflows/deploy.yml@v1\n    secrets: inherit\n`;
  assert.deepEqual(wheres(external), ["job call"]);
  assert.deepEqual(wheres(external.replace("some-org/shared/.github/workflows/deploy.yml@v1", "./.github/workflows/deploy.yml")), []);
});

test("a caller passing a deploy secret to a reusable workflow fails with advice that fits (it cannot declare an environment)", () => {
  const text = `on: push\njobs:\n  call:\n    uses: ./.github/workflows/deploy.yml\n    secrets:\n      CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}\n`;
  const [problem] = lintWorkflow(text);
  assert.equal(problem.where, "job call");
  assert.match(problem.why, /reusable workflow/);
  assert.match(problem.why, /called workflow/);
});

const step = (expr) => `on: push\njobs:\n  d:\n    steps:\n      - run: x\n        env:\n          T: \${{ ${expr} }}\n`;

test("secret names are case-insensitive, and bracket syntax counts", () => {
  for (const expr of ["secrets.cloudflare_api_token", "secrets.Cloudflare_Account_Id", "secrets['CLOUDFLARE_API_TOKEN']", 'secrets["cloudflare_api_token"]', "secrets . CLOUDFLARE_API_TOKEN"]) {
    assert.deepEqual(wheres(step(expr)), ["job d"], expr);
  }
});

test("whole-context and dynamic access count as reading every secret", () => {
  for (const expr of ["toJSON(secrets)", "secrets[matrix.name]", "secrets[format('CLOUDFLARE_{0}', matrix.k)]"]) {
    assert.deepEqual(wheres(step(expr)), ["job d"], expr);
  }
  // ...and pass with an environment
  assert.deepEqual(wheres(step("toJSON(secrets)").replace("  d:\n", "  d:\n    environment: preview\n")), []);
});

test("other secrets are not matched by a loose pattern", () => {
  for (const expr of ["secrets.CLAUDE_CODE_OAUTH_TOKEN", "secrets.NOT_CLOUDFLARE_X", "secrets.GITHUB_TOKEN"]) {
    assert.deepEqual(wheres(step(expr)), [], expr);
  }
});

test("fails closed when a reference cannot be attributed to a job", () => {
  const fourSpaces = "on: push\njobs:\n    d:\n        steps:\n          - run: x\n            env:\n              T: ${{ secrets.CLOUDFLARE_API_TOKEN }}\n";
  assert.deepEqual(wheres(fourSpaces), ["workflow"]);
  const flow = "on: push\njobs: {d: {steps: [{run: x, env: {T: '${{ secrets.CLOUDFLARE_API_TOKEN }}'}}]}}\n";
  assert.ok(wheres(flow).length > 0);
  const afterJobs = `${good}env:\n  T: \${{ secrets.CLOUDFLARE_API_TOKEN }}\n`;
  assert.deepEqual(wheres(afterJobs), ["workflow"]);
  // clean files with an environment are unaffected
  assert.deepEqual(lintWorkflow(good), []);
});

test("a nested key named environment is not the job environment", () => {
  const bad = good.replace("    environment:\n      name: production\n", "    env:\n      environment: production\n");
  assert.deepEqual(wheres(bad), ["job deploy"]);
});

test("comments and unrelated secrets are ignored", () => {
  const text = `on: push\njobs:\n  review:\n    # secrets.CLOUDFLARE_API_TOKEN lives in the production environment\n    steps:\n      - run: echo \${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}\n`;
  assert.deepEqual(lintWorkflow(text), []);
});

test("--secret widens the pattern", () => {
  const text = `on: push\njobs:\n  d:\n    steps:\n      - run: flyctl deploy\n        env:\n          T: \${{ secrets.FLY_API_TOKEN }}\n`;
  assert.deepEqual(lintWorkflow(text), []);
  assert.deepEqual(wheres(text, "CLOUDFLARE_[A-Z0-9_]+|FLY_API_TOKEN"), ["job d"]);
});

test("a workflow with no jobs: block does not crash", () => {
  assert.deepEqual(lintWorkflow("name: x\non: push\n"), []);
});

function repoWith(files) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "lint-"));
  fs.mkdirSync(path.join(repo, ".github/workflows"), { recursive: true });
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(repo, ".github/workflows", name), text);
  return repo;
}
const run = (args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });

test("CLI: exit 0 when clean, 1 with an annotation when not, 2 on bad usage", () => {
  const clean = run(["--repo", repoWith({ "deploy.yml": good })]);
  assert.equal(clean.status, 0, clean.stdout + clean.stderr);

  const bad = run(["--repo", repoWith({ "deploy.yml": without(good, "    environment:\n      name: production\n") })]);
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /::error file=\.github\/workflows\/deploy\.yml::job deploy:/);

  assert.equal(run(["--nope"]).status, 2);
  assert.equal(run(["--secret", "("]).status, 2);
});

test("CLI: a repo without workflows is clean", () => {
  assert.equal(run(["--repo", fs.mkdtempSync(path.join(os.tmpdir(), "lint-"))]).status, 0);
});

test("CLI: only .yml and .yaml files are read", () => {
  const repo = repoWith({ "notes.txt": without(good, "    environment:\n      name: production\n"), "ok.yaml": good });
  assert.equal(run(["--repo", repo]).status, 0);
});

test("this repo's own workflows and the synced lint template are clean", () => {
  assert.equal(run(["--repo", ROOT]).status, 0);
  const tpl = fs.readFileSync(path.join(ROOT, "templates/deploy-secrets-lint.yml"), "utf8");
  assert.match(tpl, /lint-workflow-secrets\.mjs --repo \./);
  assert.deepEqual(lintWorkflow(tpl), []);
});
