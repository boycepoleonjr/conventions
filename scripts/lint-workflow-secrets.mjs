#!/usr/bin/env node
// Fails when a GitHub Actions workflow reads a deploy secret outside a
// GitHub Environment restricted to specific branches (STANDARD DEP-3). It
// checks the workflow files only, not the environment's settings.
//
//   node scripts/lint-workflow-secrets.mjs [--repo <dir>] [--secret <regex>]
//
// A violation is any of:
//   - a job references secrets.<deploy secret> but has no job-level `environment:`
//   - the secret is referenced above `jobs:` (workflow-level env reaches every job)
//   - the workflow is triggered by `pull_request_target` and references the secret
//   - `secrets: inherit` is passed to an external reusable workflow (a local one is
//     linted on its own; a calling job cannot declare `environment:`)
//   - a reference cannot be attributed to a job (fail closed, see below)
//
// Deploy secrets default to secrets.CLOUDFLARE_*. Repos that deploy elsewhere
// widen it with --secret, e.g. --secret 'CLOUDFLARE_[A-Z0-9_]+|FLY_API_TOKEN'.
//
// Line based on purpose (no YAML dependency, runs on a bare Node install).
// Workflows must use block style with 2-space indentation, which is what
// GitHub's own examples and Prettier produce.
// Exit codes: 0 clean, 1 violations, 2 usage error.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_SECRET = "CLOUDFLARE_[A-Z0-9_]+";

const indentOf = (line) => line.length - line.trimStart().length;
const isComment = (line) => line.trimStart().startsWith("#");

// What counts as reading a deploy secret. Secret names are case-insensitive in
// Actions, and the context can be indexed, so this also covers:
//   secrets.name, secrets['NAME'], secrets["NAME"]
//   toJSON(secrets) and secrets[<expression>]: can read any secret, so they count
//   as reading every secret (a job doing that needs an environment too).
function secretMatcher(secretPattern) {
  const named = new RegExp(`\\bsecrets\\s*(?:\\.\\s*|\\[\\s*['"])(?:${secretPattern})\\b`, "i");
  const whole = /\btoJSON\s*\(\s*secrets\s*\)|\bsecrets\s*\[\s*[^'"\s\]]/i;
  return (line) => named.test(line) || whole.test(line);
}

export function lintWorkflow(text, secretPattern = DEFAULT_SECRET) {
  const readsSecret = secretMatcher(secretPattern);
  const lines = text.split("\n");
  const code = (l) => !isComment(l);
  const problems = [];

  const totalRefs = lines.filter((l) => code(l) && readsSecret(l)).length;
  let attributedRefs = 0;

  const jobsAt = lines.findIndex((l) => /^jobs:\s*(#.*)?$/.test(l));
  const header = lines.slice(0, jobsAt === -1 ? lines.length : jobsAt);
  // Top-level keys (`on:` included) can also follow the jobs block.
  const nextTopLevel = lines.findIndex((l, i) => i > jobsAt && l.trim() !== "" && !isComment(l) && indentOf(l) === 0);
  const afterJobs = jobsAt === -1 || nextTopLevel === -1 ? [] : lines.slice(nextTopLevel);

  if (totalRefs > 0 && [...header, ...afterJobs].some((l) => code(l) && /\bpull_request_target\b/.test(l))) {
    problems.push({ where: "workflow", why: "pull_request_target workflow references a deploy secret" });
  }
  const headerRefs = header.filter((l) => code(l) && readsSecret(l)).length;
  attributedRefs += headerRefs;
  if (headerRefs > 0) {
    problems.push({ where: "workflow level", why: "deploy secret referenced above `jobs:`, outside any environment" });
  }

  if (jobsAt !== -1) {
    let name = "";
    let body = [];
    const flush = () => {
      if (!name) return;
      const refs = body.filter((l) => code(l) && readsSecret(l)).length;
      attributedRefs += refs;
      const key = (re) => body.some((l) => code(l) && indentOf(l) === 4 && re.test(l.trim()));
      const hasEnvironment = key(/^environment\s*:/);
      const callsWorkflow = key(/^uses\s*:/);
      // `secrets: inherit` into a local reusable workflow is covered by linting
      // that workflow's own jobs. Into an external one it hands over every
      // repository secret to code this check cannot see.
      const inheritsToExternal =
        key(/^secrets\s*:\s*inherit\s*(#.*)?$/) && body.some((l) => code(l) && indentOf(l) === 4 && /^uses\s*:\s*(?!\.\/)\S/.test(l.trim()));
      if (refs > 0 && !hasEnvironment) {
        // A job that calls a reusable workflow cannot declare `environment:`
        // itself, so the fix is different: do not pass the secret in.
        problems.push({
          where: `job ${name}`,
          why: callsWorkflow
            ? "passes a deploy secret to a reusable workflow; a calling job cannot declare `environment:`, so read the secret in the called workflow's job that declares it"
            : "references a deploy secret without a job-level `environment:`",
        });
      }
      if (inheritsToExternal) {
        problems.push({
          where: `job ${name}`,
          why: "`secrets: inherit` hands every repository secret to an external reusable workflow this check cannot read; pass only what it needs",
        });
      }
    };
    for (const line of lines.slice(jobsAt + 1)) {
      if (line.trim() === "" || isComment(line)) {
        body.push(line);
        continue;
      }
      if (indentOf(line) === 0) break; // next top-level key
      if (indentOf(line) === 2 && /^[A-Za-z0-9_-]+:\s*(#.*)?$/.test(line.trim())) {
        flush();
        name = line.trim().split(":")[0];
        body = [];
      } else {
        body.push(line);
      }
    }
    flush();
  }

  // Fail closed: a secret reference that was not attributed to the header or to
  // a parsed job (4-space indentation, flow-style `jobs: {...}`, a key after the
  // `jobs:` block) must not pass silently.
  if (totalRefs > attributedRefs) {
    problems.push({
      where: "workflow",
      why: `${totalRefs - attributedRefs} deploy secret reference(s) could not be attributed to a job (use block style with 2-space indentation and keep \`jobs:\` last)`,
    });
  }
  return problems;
}

export function lintRepo(repo, secretPattern = DEFAULT_SECRET) {
  const dir = path.join(repo, ".github", "workflows");
  if (!fs.existsSync(dir)) return [];
  const results = [];
  for (const file of fs.readdirSync(dir).sort()) {
    if (!/\.ya?ml$/.test(file)) continue;
    for (const p of lintWorkflow(fs.readFileSync(path.join(dir, file), "utf8"), secretPattern)) {
      results.push({ file: `.github/workflows/${file}`, ...p });
    }
  }
  return results;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const opt = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  if (argv.some((a) => a.startsWith("--") && !["--repo", "--secret"].includes(a))) {
    console.error("usage: lint-workflow-secrets.mjs [--repo <dir>] [--secret <regex>]");
    process.exit(2);
  }
  const repo = opt("--repo") ?? ".";
  const pattern = opt("--secret") ?? DEFAULT_SECRET;
  try {
    new RegExp(pattern);
  } catch {
    console.error(`invalid --secret pattern: ${pattern}`);
    process.exit(2);
  }
  const problems = lintRepo(repo, pattern);
  for (const p of problems) {
    console.log(`::error file=${p.file}::${p.where}: ${p.why}. Put the secret in a GitHub Environment restricted to specific branches and add \`environment:\` to the job (STANDARD DEP-3).`);
  }
  if (problems.length > 0) {
    console.error(`${problems.length} deploy-secret problem(s).`);
    process.exit(1);
  }
  console.log("Deploy secrets: every job that reads them declares an environment.");
}
