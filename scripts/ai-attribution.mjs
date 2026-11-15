// Pure core of the AI attribution scrub and check (no I/O, no network).
// The synced workflows run inside actions/github-script in other repos, where this file does not exist, so each function
// is copied verbatim between its BEGIN/END markers into the template that uses it:
//   scrubBody     -> templates/ai-attribution-scrub.yml
//   commitProblems -> templates/ai-attribution-check.yml
// test/ai-attribution-scrub.test.mjs and test/ai-attribution-check.test.mjs fail if a copy drifts from this file.
// Keep each function self-contained (no module-level helpers) and free of `getOctokit` declarations (github-script v9).

// BEGIN scrubBody
export function scrubBody(body) {
  // Returns the body without a trailing AI footer, or the same string when there is nothing to remove.
  // Only the end of the body is ever cut: everything before the cut is returned byte for byte, line endings included.
  if (typeof body !== "string" || body === "") return body;
  const generated = /^\s*[*_]*(?:\u{1F916}️?\s*)?Generated (?:by|with) (?:\[Claude Code\]\([^)\s]*\)|Claude Code)[*_]*\.?\s*$/iu;
  const coAuthor = /^\s*co-authored-by:.*(?:\bclaude\b|\banthropic\b|noreply@anthropic\.com)/i;
  const session = /^\s*(?:claude-session:\s*)?(?:<|\[[^\]]*\]\()?https?:\/\/claude\.(?:ai|com)\/code\/session_[A-Za-z0-9_-]+(?:[?#][^\s)>]*)?[)>]?\s*$/i;
  const separator = /^\s*-{3,}\s*$/;
  const lines = [];
  for (let start = 0; ; ) {
    let end = start;
    while (end < body.length && body[end] !== "\n" && body[end] !== "\r") end++;
    lines.push({ text: body.slice(start, end), end });
    if (end >= body.length) break;
    start = end + (body[end] === "\r" && body[end + 1] === "\n" ? 2 : 1);
  }
  let i = lines.length - 1;
  let removed = false;
  for (; i >= 0; i--) {
    const t = lines[i].text;
    if (t.trim() === "") continue;
    if (generated.test(t) || coAuthor.test(t) || session.test(t)) { removed = true; continue; }
    if (removed && separator.test(t)) continue;
    break;
  }
  if (!removed) return body;
  return i < 0 ? "" : body.slice(0, lines[i].end);
}
// END scrubBody

// BEGIN commitProblems
export function commitProblems(c) {
  // `c` is one commit as returned by GET /repos/{owner}/{repo}/pulls/{number}/commits.
  // Returns the reasons the commit carries AI authorship (an empty list when it is fine).
  const git = c.commit || {};
  const lower = (s) => String(s || "").trim().toLowerCase();
  const authorEmail = lower(git.author && git.author.email);
  const committerEmail = lower(git.committer && git.committer.email);
  const login = lower(c.author && c.author.login);
  // Dependabot commits are ignored.
  if (login === "dependabot[bot]" || /dependabot\[bot\]@users\.noreply\.github\.com$/.test(authorEmail)) return [];
  // So are merge commits made by GitHub (the "Update branch" button, merge buttons): several parents, committed by GitHub.
  const merge = (c.parents || []).length > 1;
  if (merge && (committerEmail === "noreply@github.com" || lower(c.committer && c.committer.login) === "web-flow")) return [];
  const problems = [];
  if (authorEmail === "noreply@anthropic.com") problems.push("author email is noreply@anthropic.com");
  if (committerEmail === "noreply@anthropic.com") problems.push("committer email is noreply@anthropic.com");
  if (lower(git.author && git.author.name) === "claude") problems.push('author name is "Claude"');
  // Only the final trailer block counts, as git interpret-trailers reads it: the last paragraph, after a title paragraph,
  // where every line is a "Key: value" trailer (or an indented continuation of one). A line quoted in prose is not a trailer.
  const lines = String(git.message || "").split(/\r?\n/);
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  let start = lines.length;
  while (start > 0 && lines[start - 1].trim() !== "") start--;
  const block = lines.slice(start);
  const trailers = [];
  let valid = start > 0 && lines.slice(0, start).some((l) => l.trim() !== "");
  for (const line of block) {
    if (/^[A-Za-z0-9-]+[ \t]*:/.test(line)) trailers.push(line);
    else if (/^[ \t]+\S/.test(line) && trailers.length > 0) trailers[trailers.length - 1] += " " + line.trim();
    else valid = false;
  }
  if (valid && trailers.some((t) => /^co-authored-by[ \t]*:.*(?:\bclaude\b|\banthropic\b)/i.test(t))) problems.push("message has a Co-Authored-By trailer naming Claude or Anthropic");
  if (valid && trailers.some((t) => /^claude-session[ \t]*:/i.test(t))) problems.push("message has a Claude-Session trailer");
  return problems;
}
// END commitProblems
