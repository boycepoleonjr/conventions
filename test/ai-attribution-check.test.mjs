// node --test test/*.test.mjs
// CI-7: the synced "AI attribution check" job fails a PR, loudly, when a commit carries AI authorship.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { commitProblems, AI_AGENTS, agentOf, agentInTrailer } from "../scripts/ai-attribution.mjs";
import { usesRefs, isSha } from "../scripts/sync.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = "templates/ai-attribution-check.yml";
const DEST = ".github/workflows/ai-attribution-check.yml";
const TEMPLATE = fs.readFileSync(path.join(ROOT, SRC), "utf8");
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
const SCRIPT = fs.readFileSync(path.join(ROOT, "scripts/ai-attribution.mjs"), "utf8");
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

function workflowScript(text = TEMPLATE) {
  const m = text.match(/\n {10}script: \|\n((?: {12}.*\n|\n)+)/);
  assert.ok(m, "the workflow has a script block");
  return m[1].replace(/^ {12}/gm, "");
}
const embedded = (text, name) => text.match(new RegExp(`// BEGIN ${name}\\n([\\s\\S]*?)// END ${name}\\n`))[1];

// A commit shaped like the REST API's pulls.listCommits items.
const commit = (over = {}) => ({
  sha: "a".repeat(40),
  author: { login: "boycepoleonjr" },
  committer: { login: "boycepoleonjr" },
  parents: [{ sha: "b".repeat(40) }],
  ...over,
  commit: {
    message: "feat: add a thing",
    author: { name: "Boyce Poleon, Jr.", email: "17016723+boycepoleonjr@users.noreply.github.com" },
    committer: { name: "Boyce Poleon, Jr.", email: "17016723+boycepoleonjr@users.noreply.github.com" },
    ...(over.commit || {}),
  },
});

// ---- the pure function ------------------------------------------------------------------------------------------------

test("a commit by the owner is fine", () => {
  assert.deepEqual(commitProblems(commit()), []);
  assert.deepEqual(commitProblems(commit({ commit: { message: "fix: x\n\nCo-Authored-By: Alice Example <alice@example.com>" } })), []);
});

test("author or committer email noreply@anthropic.com is flagged", () => {
  const a = commitProblems(commit({ commit: { author: { name: "Someone", email: "noreply@anthropic.com" } } }));
  assert.deepEqual(a, ["author email is noreply@anthropic.com (Claude)"]);
  const c = commitProblems(commit({ commit: { committer: { name: "Someone", email: "NoReply@Anthropic.com" } } }));
  assert.deepEqual(c, ["committer email is noreply@anthropic.com (Claude)"]);
});

test("author name Claude is flagged, other names containing it are not", () => {
  assert.deepEqual(commitProblems(commit({ commit: { author: { name: "Claude", email: "x@example.com" } } })), ['author name is "Claude"']);
  assert.deepEqual(commitProblems(commit({ commit: { author: { name: "claude", email: "x@example.com" } } })), ['author name is "claude"']);
  assert.deepEqual(commitProblems(commit({ commit: { author: { name: "Claude Debussy", email: "x@example.com" } } })), []);
});

test("Co-Authored-By trailers naming Claude or Anthropic are flagged", () => {
  for (const line of ["Co-Authored-By: Claude <noreply@anthropic.com>", "Co-authored-by: Claude Opus 5.5 <x@example.com>", "co-authored-by: Anthropic Bot <x@example.com>", "Co-Authored-By: Agent <noreply@anthropic.com>"]) {
    assert.equal(commitProblems(commit({ commit: { message: `fix: x\n\nBody.\n\n${line}\n` } })).length, 1, line);
  }
  assert.deepEqual(commitProblems(commit({ commit: { message: "fix: x\n\nWe asked Claude about this, Co-Authored-By is not a trailer here" } })), []);
});

test("a Claude-Session trailer is flagged", () => {
  assert.deepEqual(commitProblems(commit({ commit: { message: "fix: x\n\nClaude-Session: https://claude.ai/code/session_01Abc" } })), ["message has a Claude-Session trailer"]);
});

// ---- trailers only: attribution quoted in prose is not authorship (Codex P2) -----------------------------------------------

const withMessage = (message) => commit({ commit: { message } });
const CO = "Co-Authored-By: Claude <noreply@anthropic.com>";
const SESS = "Claude-Session: https://claude.ai/code/session_01Abc";

test("trailers: the same lines quoted in prose are not attribution", () => {
  for (const [name, message] of [
    ["Codex's example", `docs: add fixture\n\nThe fixture contains:\n${CO}\n\nThis is example input, not authorship metadata.`],
    ["glued to a body paragraph", `docs: x\n\nThe fixture contains:\n${CO}`],
    ["trailer-shaped block followed by prose", `docs: x\n\n${CO}\n${SESS}\n\nExample input only.`],
    ["a Claude-Session line quoted in prose", `docs: x\n\nThe hook writes this line:\n${SESS}\n\nThat is all.`],
    ["right under the subject, no blank line", `docs: x\n${CO}`],
    ["the only paragraph of the message", CO],
    ["indented in a code block", `docs: x\n\n    ${CO}\n    ${SESS}\n\nDone.`],
    ["in a fenced block", `docs: x\n\n\`\`\`\n${CO}\n\`\`\`\n`],
    ["a trailer line beside a non-trailer line in the last paragraph", `docs: x\n\nFixes the thing.\n${CO}`],
    ["mentioned in a sentence", `docs: x\n\nWe strip the Co-Authored-By: Claude line from PR text.`],
  ]) {
    assert.deepEqual(commitProblems(withMessage(message)), [], name);
  }
});

test("trailers: real trailers in the final block are still flagged", () => {
  const co = ["message has a Co-Authored-By trailer naming Claude"];
  const session = ["message has a Claude-Session trailer"];
  for (const [name, message, want] of [
    ["plain", `feat: x\n\n${CO}`, co],
    ["after a body", `feat: x\n\nBody text.\n\n${CO}`, co],
    ["trailing blank lines", `feat: x\n\nBody.\n\n${CO}\n\n\n`, co],
    ["mixed with other trailers", `feat: x\n\nSigned-off-by: A <a@example.com>\n${CO}\n${SESS}`, [...co, ...session]],
    ["Claude-Session alone", `feat: x\n\n${SESS}`, session],
    ["Windows line endings", `feat: x\r\n\r\nBody.\r\n\r\n${CO}\r\n${SESS}\r\n`, [...co, ...session]],
    ["continuation line", `feat: x\n\nCo-Authored-By: Claude\n  <noreply@anthropic.com>`, co],
    ["lower case key", `feat: x\n\nco-authored-by: Claude Opus 5.5 <noreply@anthropic.com>`, co],
    ["Anthropic by name", `feat: x\n\nCo-Authored-By: Anthropic Bot <bot@example.com>`, co],
    ["a quote in the body does not hide the real trailer", `feat: x\n\nThe fixture contains:\n${CO}\n\nExample only.\n\n${CO}`, co],
  ]) {
    assert.deepEqual(commitProblems(withMessage(message)), want, name);
  }
});

test("trailers: a person's Co-Authored-By in the final block is fine, even next to a quoted Claude line", () => {
  assert.deepEqual(commitProblems(withMessage(`feat: x\n\nCo-Authored-By: Alice Example <alice@example.com>`)), []);
  assert.deepEqual(commitProblems(withMessage(`feat: x\n\nQuoted: ${CO}\n\nCo-Authored-By: Alice Example <alice@example.com>`)), []);
});

test("trailers: agrees with git interpret-trailers on every message above", () => {
  const messages = [
    `docs: add fixture\n\nThe fixture contains:\n${CO}\n\nThis is example input, not authorship metadata.\n`,
    `docs: x\n\nThe fixture contains:\n${CO}\n`,
    `docs: x\n${CO}\n`,
    `${CO}\n`,
    `docs: x\n\nFixes the thing.\n${CO}\n`,
    `feat: x\n\n${CO}\n`,
    `feat: x\n\nBody.\n\n${CO}\n\n\n`,
    `feat: x\n\nSigned-off-by: A <a@example.com>\n${CO}\n${SESS}\n`,
    `feat: x\n\n${SESS}\n`,
    `feat: x\r\n\r\nBody.\r\n\r\n${CO}\r\n${SESS}\r\n`,
    `feat: x\n\nCo-Authored-By: Claude\n  <noreply@anthropic.com>\n`,
    `feat: x\n\nThe fixture contains:\n${CO}\n\nExample only.\n\n${CO}\n`,
    `feat: x\n\nCo-Authored-By: Alice Example <alice@example.com>\n`,
  ];
  for (const message of messages) {
    const r = spawnSync("git", ["interpret-trailers", "--parse"], { input: message, encoding: "utf8" });
    assert.equal(r.status, 0, "git interpret-trailers ran");
    const gitSaysAttribution = /^(co-authored-by[ \t]*:.*(claude|anthropic)|claude-session[ \t]*:)/im.test(r.stdout.replace(/\r/g, ""));
    assert.equal(commitProblems(withMessage(message)).length > 0, gitSaysAttribution, JSON.stringify(message));
  }
});

// ---- vendor-independent: any AI coding agent identity (v1.9.1) -------------------------------------------------------------

const HUMAN = { name: "Boyce Poleon, Jr.", email: "17016723+boycepoleonjr@users.noreply.github.com" };
const byAuthor = (name, email, login) => commit({ ...(login ? { author: { login } } : {}), commit: { author: { name, email }, committer: HUMAN } });
const byCommitter = (name, email) => commit({ commit: { author: HUMAN, committer: { name, email } } });

// [label, author name, author email, author login]
const IDENTITIES = [
  ["Claude", "Claude", "noreply@anthropic.com", "claude"],
  ["Codex", "Codex", "codex@openai.com", "codex"],
  ["Codex", "chatgpt-codex-connector[bot]", "1+chatgpt-codex-connector[bot]@users.noreply.github.com", "chatgpt-codex-connector[bot]"],
  ["Cursor Agent", "Cursor Agent", "cursoragent@cursor.com", "cursoragent"],
  ["Copilot", "Copilot", "198982749+Copilot@users.noreply.github.com", "Copilot"],
  ["Copilot", "copilot-swe-agent[bot]", "198982749+copilot-swe-agent[bot]@users.noreply.github.com", "copilot-swe-agent[bot]"],
  ["Jules", "Jules", "161369871+google-labs-jules[bot]@users.noreply.github.com", "jules"],
  ["Jules", "google-labs-jules[bot]", "161369871+google-labs-jules[bot]@users.noreply.github.com", "google-labs-jules[bot]"],
  ["Gemini", "gemini-code-assist[bot]", "1+gemini-code-assist[bot]@users.noreply.github.com", "gemini-code-assist[bot]"],
];

test("agents: every listed identity is flagged by author name, by author email, and as a committer", () => {
  for (const [label, name, email] of IDENTITIES) {
    const viaName = commitProblems(byAuthor(name, "human@example.com"));
    const viaEmail = commitProblems(byAuthor("Someone", email));
    const viaCommitterName = commitProblems(byCommitter(name, "human@example.com"));
    const viaCommitterEmail = commitProblems(byCommitter("Someone", email));
    assert.ok(viaName.length === 1 && viaName[0].startsWith("author name is"), `${name} as author name: ${viaName}`);
    assert.ok(viaEmail.length === 1 && viaEmail[0] === `author email is ${email.toLowerCase()} (${label})`, `${email} as author email: ${viaEmail}`);
    assert.ok(viaCommitterName.length === 1 && viaCommitterName[0].startsWith("committer name is"), `${name} as committer name: ${viaCommitterName}`);
    assert.ok(viaCommitterEmail.length === 1 && viaCommitterEmail[0].startsWith("committer email is"), `${email} as committer email: ${viaCommitterEmail}`);
  }
});

test("agents: any @openai.com address is flagged as an author or committer email (a human at that domain would be too)", () => {
  assert.deepEqual(commitProblems(byAuthor("Someone", "bot@openai.com")), ["author email is bot@openai.com (Codex)"]);
  assert.deepEqual(commitProblems(byCommitter("Someone", "BOT@OpenAI.com")), ["committer email is bot@openai.com (Codex)"]);
  assert.deepEqual(commitProblems(byAuthor("Someone", "bot@notopenai.com")), []);
});

test("agents: a GitHub login alone identifies the agent", () => {
  for (const [label, , , login] of IDENTITIES) {
    assert.deepEqual(commitProblems(commit({ author: { login }, commit: { author: { name: "x", email: "x@example.com" }, committer: HUMAN } })).length, 1, `${label} ${login}`);
  }
});

test("agents: Co-Authored-By trailers naming any of them are flagged, with the tool named", () => {
  for (const [line, label] of [
    ["Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>", "Claude"],
    ["Co-authored-by: Codex <codex@openai.com>", "Codex"],
    ["Co-authored-by: OpenAI Codex <x@example.com>", "Codex"],
    ["Co-authored-by: Cursor Agent <cursoragent@cursor.com>", "Cursor Agent"],
    ["Co-authored-by: Copilot <198982749+Copilot@users.noreply.github.com>", "Copilot"],
    ["Co-authored-by: GitHub Copilot <x@example.com>", "Copilot"],
    ["Co-authored-by: Jules <jules@example.com>", "Jules"],
    ["Co-authored-by: google-labs-jules[bot] <161369871+google-labs-jules[bot]@users.noreply.github.com>", "Jules"],
    ["Co-authored-by: Someone <bot@openai.com>", "Codex"],
  ]) {
    assert.deepEqual(commitProblems(withMessage(`feat: x\n\nBody.\n\n${line}`)), [`message has a Co-Authored-By trailer naming ${label}`], line);
  }
});

test("agents: a trailer naming two tools reports each, and a Claude-Session trailer still counts", () => {
  const p = commitProblems(withMessage(`feat: x\n\nCo-authored-by: Codex <codex@openai.com>\nCo-authored-by: Copilot <198982749+Copilot@users.noreply.github.com>\n${SESS}`));
  assert.deepEqual(p, ["message has a Co-Authored-By trailer naming Codex", "message has a Co-Authored-By trailer naming Copilot", "message has a Claude-Session trailer"]);
});

test("agents: people and words that only look similar are not flagged", () => {
  for (const [name, email] of [["Jules Verne", "jv@example.com"], ["Claudette Colvin", "cc@example.com"], ["Cursor", "cursor@example.com"], ["Copilota", "c@example.com"], ["Alice Example", "alice@openai.example"], ["Codexa", "c@example.com"]]) {
    assert.deepEqual(commitProblems(byAuthor(name, email)), [], name);
  }
  for (const line of ["Co-authored-by: Jules Verne <jv@example.com>", "Co-authored-by: Claudette Colvin <cc@example.com>", "Co-authored-by: Alice Example <alice@example.com>", "Co-authored-by: Cursor Fan <c@example.com>"]) {
    assert.deepEqual(commitProblems(withMessage(`feat: x\n\n${line}`)), [], line);
  }
  assert.deepEqual(commitProblems(withMessage("docs: x\n\nCopilot, Codex, Jules and Cursor Agent are mentioned in prose.")), []);
});

test("agents: Dependabot, github-actions[bot] and GitHub merge commits are ignored", () => {
  const dep = commit({ author: { login: "dependabot[bot]" }, commit: { author: { name: "dependabot[bot]", email: "49699333+dependabot[bot]@users.noreply.github.com" }, message: "chore(deps): bump x" } });
  const actions = commit({ author: { login: "github-actions[bot]" }, commit: { author: { name: "github-actions[bot]", email: "41898282+github-actions[bot]@users.noreply.github.com" }, message: "chore: update lockfile" } });
  const merge = commit({ parents: [{ sha: "1" }, { sha: "2" }], committer: { login: "web-flow" }, commit: { message: "Merge branch 'main' into feat", author: { name: "Copilot", email: "198982749+Copilot@users.noreply.github.com" }, committer: { name: "GitHub", email: "noreply@github.com" } } });
  for (const c of [dep, actions, merge]) assert.deepEqual(commitProblems(c), []);
  const local = commit({ parents: [{ sha: "1" }, { sha: "2" }], commit: { message: "Merge branch 'main'", author: { name: "Codex", email: "codex@openai.com" } } });
  assert.ok(commitProblems(local).length > 0, "a merge that GitHub did not make is still checked");
});

test("agents: one data structure drives the check (a tool added to the list is flagged, nothing else changes)", () => {
  assert.deepEqual(commitProblems(byAuthor("Newbot", "new@example.com")), []);
  AI_AGENTS.agents.push({ label: "Newbot", names: ["newbot"], emails: [], emailSuffixes: ["@newbot.example"], words: ["newbot"], footers: [] });
  try {
    assert.equal(commitProblems(byAuthor("Newbot", "x@example.com")).length, 1);
    assert.equal(commitProblems(byAuthor("Someone", "x@newbot.example")).length, 1);
    assert.deepEqual(commitProblems(withMessage("feat: x\n\nCo-authored-by: Newbot <x@example.com>")), ["message has a Co-Authored-By trailer naming Newbot"]);
  } finally {
    AI_AGENTS.agents.pop();
  }
  assert.deepEqual(commitProblems(byAuthor("Newbot", "new@example.com")), []);
});

test("agents: the list is well formed (labels unique, matchers lower case and non-empty, tool names and emails not shared)", () => {
  const labels = AI_AGENTS.agents.map((a) => a.label);
  assert.equal(new Set(labels).size, labels.length);
  const seen = new Map();
  for (const a of AI_AGENTS.agents) {
    assert.ok(a.label && a.names.length > 0 && a.words.length > 0, a.label);
    for (const v of [...a.names, ...a.emails, ...a.emailSuffixes, ...a.words]) assert.equal(v, v.toLowerCase(), `${a.label}: ${v} is lower case`);
    for (const v of [...a.names, ...a.emails, ...a.words]) {
      assert.ok(!seen.has(v) || seen.get(v) === a.label, `${v} belongs to ${seen.get(v)} and ${a.label}`);
      seen.set(v, a.label);
    }
    for (const v of [...a.names, ...a.emails, ...a.emailSuffixes, ...a.words, ...a.footers]) assert.equal(v, v.trim(), `${a.label}: "${v}" has no stray spaces`);
  }
  assert.deepEqual(AI_AGENTS.sessionTrailers, ["claude-session"]);
  assert.deepEqual(AI_AGENTS.ignore.names, ["dependabot", "github-actions"]);
  assert.equal(agentOf({ name: "Claude" }), "Claude");
  assert.equal(agentOf({ name: "nobody" }), "");
  assert.equal(agentInTrailer(" Claude <noreply@anthropic.com>"), "Claude");
});

test("every problem on a commit is reported", () => {
  const p = commitProblems(commit({ commit: { author: { name: "Claude", email: "noreply@anthropic.com" }, committer: { name: "Claude", email: "noreply@anthropic.com" }, message: "x\n\nCo-Authored-By: Claude <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01Abc" } }));
  assert.equal(p.length, 6);
});

test("Dependabot commits are ignored", () => {
  assert.deepEqual(commitProblems(commit({ author: { login: "dependabot[bot]" }, commit: { author: { name: "dependabot[bot]", email: "49699333+dependabot[bot]@users.noreply.github.com" }, message: "chore(deps): bump x\n\nCo-Authored-By: Anthropic <x@y.z>" } })), []);
});

test("GitHub merge commits are ignored, a local merge by an AI tool is not", () => {
  const github = commit({ parents: [{ sha: "1" }, { sha: "2" }], committer: { login: "web-flow" }, commit: { message: "Merge branch 'main' into feat", committer: { name: "GitHub", email: "noreply@github.com" }, author: { name: "Claude", email: "noreply@anthropic.com" } } });
  assert.deepEqual(commitProblems(github), []);
  const local = commit({ parents: [{ sha: "1" }, { sha: "2" }], commit: { message: "Merge branch 'main'", author: { name: "Claude", email: "noreply@anthropic.com" } } });
  assert.ok(commitProblems(local).length > 0);
  const single = commit({ parents: [{ sha: "1" }], committer: { login: "web-flow" }, commit: { committer: { name: "GitHub", email: "noreply@github.com" }, author: { name: "Claude", email: "noreply@anthropic.com" } } });
  assert.ok(commitProblems(single).length > 0, "a GitHub-committed commit with one parent (squash, web edit) is still checked");
});

test("a commit with missing fields does not throw", () => {
  assert.deepEqual(commitProblems({ sha: "x" }), []);
  assert.deepEqual(commitProblems({ sha: "x", commit: {} }), []);
});

// ---- the embedded copy and the template contract --------------------------------------------------------------------------

test("the copies in the workflow are the blocks in scripts/ai-attribution.mjs", () => {
  for (const name of ["aiAgents", "commitProblems"]) {
    assert.equal(embedded(workflowScript(), name), embedded(SCRIPT, name).replace(/^export /gm, ""), name);
  }
});

test("manifest: installed as .github/workflows/ai-attribution-check.yml, a replace file with repo-owned refs", () => {
  const f = MANIFEST.files.find((x) => x.id === "ai-attribution-check");
  assert.deepEqual(f, { id: "ai-attribution-check", src: SRC, dest: DEST, mode: "replace", refs: "repo" });
});

test("workflow: SHA pin, read-only permissions, the PR events, a stable job name", () => {
  const refs = usesRefs(TEMPLATE);
  assert.deepEqual(refs.map((u) => u.action), ["actions/github-script"]);
  for (const u of refs) {
    assert.ok(isSha(u.ref));
    assert.match(u.comment, /^ # v\d+\.\d+\.\d+$/);
  }
  assert.match(TEMPLATE, /^permissions: \{\}\n/m, "deny by default at the workflow level");
  assert.match(TEMPLATE, /^ {4}name: AI attribution check\n {4}runs-on: ubuntu-latest\n {4}permissions:\n {6}contents: read\n {6}pull-requests: read\n {4}steps:\n/m, "the job grants exactly contents read and pull-requests read");
  const code = TEMPLATE.replace(/^\s*#.*$/gm, "");
  assert.ok(!/:\s*write\b|pull_request_target|secrets\.|actions\/checkout/.test(code), "read-only, no checkout of PR code, no secrets");
  assert.match(TEMPLATE, /^on:\n {2}pull_request:\n {4}types: \[opened, synchronize, reopened\]\npermissions:/m);
  assert.match(TEMPLATE, /^ {2}check:\n(?: {4}#.*\n)* {4}name: AI attribution check\n {4}runs-on: ubuntu-latest\n/m, "the job name is the required-check context");
  assert.ok(!code.includes("${{"));
});

// ---- the script against a fake GitHub ----------------------------------------------------------------------------------------

async function run(commits, prCommits = commits.length) {
  const out = { errors: [], info: [], failed: [], pages: [] };
  const github = {
    rest: { pulls: { listCommits: Symbol("listCommits") } },
    paginate: async (fn, args) => { out.pages.push([fn, args]); return commits; },
  };
  const core = { error: (m) => out.errors.push(m), info: (m) => out.info.push(m), setFailed: (m) => out.failed.push(m) };
  const context = { repo: { owner: "octo", repo: "demo" }, payload: { pull_request: { number: 9, commits: prCommits, base: { ref: "main" }, head: { ref: "feat/x" } } } };
  await new AsyncFunction("github", "context", "core", workflowScript())(github, context, core);
  return { ...out, github };
}
const BAD = commit({ sha: "d".repeat(40), commit: { message: "feat: x\n\nCo-Authored-By: Claude <noreply@anthropic.com>", author: { name: "Claude", email: "noreply@anthropic.com" } } });
const BAD2 = commit({ sha: "e".repeat(40), commit: { message: "fix: y\n\nClaude-Session: https://claude.ai/code/session_01Abc" } });

test("script: clean PR passes without failing the job", async () => {
  const r = await run([commit(), commit({ sha: "c".repeat(40) })]);
  assert.deepEqual(r.failed, []);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.pages[0][1], { owner: "octo", repo: "demo", pull_number: 9, per_page: 100 });
  assert.equal(r.pages[0][0], r.github.rest.pulls.listCommits);
});

test("script: a bad commit fails loudly, naming its SHA, why, and how to fix it", async () => {
  const r = await run([commit(), BAD, BAD2]);
  assert.equal(r.failed.length, 1);
  const msg = r.failed[0];
  assert.match(msg, /AI attribution check failed: 2 commit\(s\)/);
  assert.ok(msg.includes("d".repeat(40)) && msg.includes("e".repeat(40)), "both bad SHAs are named");
  assert.ok(!msg.includes("a".repeat(40)), "the good commit is not named");
  assert.match(msg, /re-push the same changes on a new branch with commits authored by the repo owner \(octo\)/);
  assert.match(msg, /no force push needed/);
  assert.match(msg, /git switch -c <new-branch> origin\/main/);
  assert.match(msg, /git merge --squash origin\/feat\/x/);
  assert.equal(r.errors.length, 2, "one annotation per bad commit");
  assert.ok(r.errors[0].startsWith("d".repeat(40)) && r.errors[0].includes("feat: x") && r.errors[0].includes("Co-Authored-By"));
  assert.ok(r.errors[1].startsWith("e".repeat(40)) && r.errors[1].includes("Claude-Session"));
});

test("script: a PR with commits by several agents fails once, naming every SHA and tool", async () => {
  const a = byAuthor("Codex", "codex@openai.com"); a.sha = "1".repeat(40);
  const b = commit({ sha: "2".repeat(40), commit: { author: HUMAN, committer: HUMAN, message: "feat: y\n\nCo-authored-by: Copilot <198982749+Copilot@users.noreply.github.com>" } });
  const r = await run([commit(), a, b]);
  assert.equal(r.failed.length, 1);
  assert.ok(r.failed[0].includes("1".repeat(40)) && r.failed[0].includes("2".repeat(40)));
  assert.ok(r.errors[0].includes("(Codex)") && r.errors[1].includes("naming Copilot"));
});

test("script: a commit that only quotes attribution syntax in prose does not fail the PR", async () => {
  const quoting = commit({ sha: "f".repeat(40), commit: { message: `docs: document the check\n\nThe fixture contains:\n${CO}\n${SESS}\n\nThis is example input, not authorship metadata.` } });
  const r = await run([quoting]);
  assert.deepEqual(r.failed, []);
  assert.deepEqual(r.errors, []);
});

test("script: Dependabot and GitHub merge commits do not fail it", async () => {
  const dep = commit({ sha: "1".repeat(40), author: { login: "dependabot[bot]" }, commit: { message: "chore(deps): bump", author: { name: "dependabot[bot]", email: "49699333+dependabot[bot]@users.noreply.github.com" } } });
  const merge = commit({ sha: "2".repeat(40), parents: [{ sha: "x" }, { sha: "y" }], committer: { login: "web-flow" }, commit: { message: "Merge branch 'main' into feat/x", committer: { name: "GitHub", email: "noreply@github.com" } } });
  const r = await run([dep, merge]);
  assert.deepEqual(r.failed, []);
});

test("script: a commit list shorter than the PR's commit count fails (unchecked is not a pass)", async () => {
  const r = await run([commit()], 300);
  assert.equal(r.failed.length, 1);
  assert.match(r.failed[0], /could not list every commit: got 1 of 300/);
});

// ---- sync installs it --------------------------------------------------------------------------------------------------------

test("a new repo gets the workflow with the version filled in, and --check is clean", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "attrchk-"));
  fs.writeFileSync(path.join(repo, "package.json"), JSON.stringify({ name: "demo-app", scripts: { test: "jest" } }));
  fs.writeFileSync(path.join(repo, "package-lock.json"), "{}");
  fs.writeFileSync(path.join(repo, "tsconfig.json"), "{}");
  const run1 = (args) => spawnSync(process.execPath, [path.join(ROOT, "scripts/sync.mjs"), "--repo", repo, ...args], { encoding: "utf8" });
  assert.equal(run1(["--init"]).status, 0);
  assert.equal(fs.readFileSync(path.join(repo, DEST), "utf8"), TEMPLATE.replace("{{conventions.version}}", fs.readFileSync(path.join(ROOT, "VERSION"), "utf8").trim()));
  assert.equal(run1(["--check"]).status, 0);
});
