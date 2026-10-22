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
//   - `secrets: inherit` is passed to a reusable workflow from a job without `environment:`
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

export function lintWorkflow(text, secretPattern = DEFAULT_SECRET) {
  const secret = new RegExp(`secrets\\.(?:${secretPattern})`);
  const lines = text.split("\n");
  const code = (l) => !isComment(l);
  const problems = [];

  const jobsAt = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  const header = lines.slice(0, jobsAt === -1 ? lines.length : jobsAt);

  const usesSecret = lines.some((l) => code(l) && secret.test(l));
  if (usesSecret && header.some((l) => code(l) && /\bpull_request_target\b/.test(l))) {
    problems.push({ where: "workflow", why: "pull_request_target workflow references a deploy secret" });
  }
  if (header.some((l) => code(l) && secret.test(l))) {
    problems.push({ where: "workflow level", why: "deploy secret referenced above `jobs:`, outside any environment" });
  }
  if (jobsAt === -1) return problems;

  let name = "";
  let body = [];
  const flush = () => {
    if (!name) return;
    const hasEnvironment = body.some((l) => code(l) && indentOf(l) === 4 && /^environment\s*:/.test(l.trim()));
    const readsSecret = body.some((l) => code(l) && secret.test(l));
    const inherits = body.some((l) => code(l) && indentOf(l) === 4 && /^secrets\s*:\s*inherit\s*$/.test(l.trim()));
    if (readsSecret && !hasEnvironment) {
      problems.push({ where: `job ${name}`, why: "references a deploy secret without a job-level `environment:`" });
    }
    if (inherits && !hasEnvironment) {
      problems.push({ where: `job ${name}`, why: "`secrets: inherit` without a job-level `environment:`" });
    }
  };
  for (const line of lines.slice(jobsAt + 1)) {
    if (line.trim() === "" || isComment(line)) {
      body.push(line);
      continue;
    }
    if (indentOf(line) === 0) break; // next top-level key
    if (indentOf(line) === 2 && /^[A-Za-z0-9_-]+:\s*$/.test(line.trim())) {
      flush();
      name = line.trim().slice(0, -1);
      body = [];
    } else {
      body.push(line);
    }
  }
  flush();
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
