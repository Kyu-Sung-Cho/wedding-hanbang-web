import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const patterns = [
  { name: "OpenAI API key", regex: /\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b/g },
  { name: "AWS access key", regex: /\bAKIA[0-9A-Z]{16}\b/g },
  {
    name: "GitHub token",
    regex: /\b(?:(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
  },
  { name: "Slack token", regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: "Google API key", regex: /\bAIza[0-9A-Za-z_-]{30,}\b/g },
  {
    name: "Supabase/JWT token",
    regex: /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    name: "Supabase personal access token",
    regex: /\bsbp_[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    name: "Supabase secret API key",
    regex: /\bsb_secret_[A-Za-z0-9._-]{20,}\b/g,
  },
  {
    name: "Resend API key",
    regex: /\bre_[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    name: "age identity secret",
    regex: /\bAGE-SECRET-KEY-1[0-9A-Z]{20,}\b/g,
  },
  {
    name: "PEM private key",
    regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g,
  },
  {
    name: "Cloudflare Turnstile secret key",
    // Production Turnstile secrets use the 0x-prefixed form. Match the raw
    // value as well as env assignments so a key pasted directly into code is
    // not missed. Cloudflare's documented 1x/2x/3x dummy keys do not match.
    regex: /\b0x[0-9A-Za-z_-]{30,}\b/g,
  },
  {
    name: "Kakao Admin key",
    // Kakao's Native app, JavaScript, and REST API keys are distributed
    // client identifiers whose protection comes from registered platforms,
    // domains, redirect URIs, IP restrictions, and (for REST OAuth) a client
    // secret. The Admin key is the server credential that must never be
    // committed, so only that credential family belongs in a secret gate.
    regex: /(?:KAKAO[_ -]?ADMIN(?:[_ -]?(?:APP|API))?[_ -]?KEY|(?:Admin|어드민|관리자)[^\r\n]{0,24}(?:key|키))\s*[:=]\s*[0-9a-f]{32}\b/gi,
  },
  {
    name: "credential-bearing service URL",
    regex: /\b(?:postgres|mysql|mongodb|redis):\/\/[^\s/:]+:[^\s/@]+@/gi,
  },
];

// One historical unit-test sentinel was deliberately shaped like an OpenAI
// key. It is public, non-billable test data, and cannot be removed from an
// append-only history scan without rewriting history. Exempt only its exact
// SHA-256 digest; never exempt arbitrary values containing words such as
// "test" or "example" because real random credentials can contain them.
const KNOWN_NON_SECRET_FIXTURE_DIGESTS = new Map([
  ["OpenAI API key", new Set([
    "4407f925b7de7c324ad8de77d33e3e22504fd7105f8a725f60782c22fc1dabaf",
  ])],
  ["Cloudflare Turnstile secret key", new Set([
    "f712323f657b889c4023ede5c822df36e725e806d156e7e5d19ecb07d5c4fb78",
  ])],
]);

function isKnownNonSecretFixture(category, candidate) {
  const allowed = KNOWN_NON_SECRET_FIXTURE_DIGESTS.get(category);
  if (!allowed) return false;
  const digest = createHash("sha256").update(candidate).digest("hex");
  return allowed.has(digest);
}

function lineNumberAt(text, index) {
  let line = 1;
  for (let offset = 0; offset < index; offset += 1) {
    if (text.charCodeAt(offset) === 10) line += 1;
  }
  return line;
}

function repositoryFiles() {
  const output = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    },
  );
  return output.split("\0").filter(Boolean);
}

function repositoryHistoryCommits() {
  const output = execFileSync("git", ["rev-list", "--all"], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return output
    .split(/\r?\n/)
    .filter((commit) => /^[0-9a-f]{40}$/i.test(commit));
}

function repositoryCommitMessages() {
  const output = execFileSync(
    "git",
    ["log", "--all", "--format=%x1e%H%x00%B"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    },
  );

  return output
    .split("\x1e")
    .map((record) => {
      const separator = record.indexOf("\0");
      if (separator < 0) return null;
      const commit = record.slice(0, separator).trim();
      if (!/^[0-9a-f]{40}$/i.test(commit)) return null;
      return { commit, message: record.slice(separator + 1) };
    })
    .filter(Boolean);
}

function repositoryAnnotatedTags() {
  const output = execFileSync(
    "git",
    ["for-each-ref", "--format=%(objecttype)%00%(objectname)", "refs/tags"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const tags = [];
  for (const line of output.split(/\r?\n/)) {
    const [objectType, objectId] = line.split("\0");
    if (objectType !== "tag" || !/^[0-9a-f]{40,64}$/i.test(objectId ?? "")) continue;
    const contents = execFileSync("git", ["cat-file", "tag", objectId], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 16 * 1024 * 1024,
    });
    tags.push({ objectId, contents });
  }
  return tags;
}

function repositoryCommitPatch(commit) {
  try {
    return execFileSync(
      "git",
      [
        "show",
        "--format=",
        "--no-ext-diff",
        "--no-textconv",
        "--no-renames",
        "--no-color",
        "--root",
        "-m",
        commit,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 64 * 1024 * 1024,
      },
    );
  } catch {
    // Never forward a failed command's captured patch because it could contain
    // the credential this boundary exists to redact.
    throw new Error(`[repository-secret-scan] history scan failed at ${commit}`);
  }
}

export function scanText(file, text) {
  const findings = [];
  for (const pattern of patterns) {
    pattern.regex.lastIndex = 0;
    for (const match of text.matchAll(pattern.regex)) {
      if (isKnownNonSecretFixture(pattern.name, match[0])) continue;
      findings.push({
        category: pattern.name,
        file,
        line: lineNumberAt(text, match.index ?? 0),
      });
    }
  }
  return findings;
}

export function aggregateFindings(findings) {
  const aggregated = new Map();
  for (const finding of findings) {
    const key = `${finding.category}\0${finding.file}\0${finding.line ?? ""}`;
    const previous = aggregated.get(key);
    aggregated.set(key, previous
      ? { ...previous, occurrences: previous.occurrences + 1 }
      : { ...finding, occurrences: 1 });
  }
  return [...aggregated.values()];
}

function main() {
  const files = repositoryFiles();
  const findings = [];

  for (const file of files) {
    let buffer;
    try {
      buffer = readFileSync(file);
    } catch {
      continue;
    }
    if (buffer.includes(0)) continue;
    findings.push(...scanText(file, buffer.toString("utf8")));
  }

  const historyCommits = repositoryHistoryCommits();
  for (const commit of historyCommits) {
    const patch = repositoryCommitPatch(commit);
    for (const finding of scanText(`git:${commit}`, patch)) {
      findings.push({ ...finding, line: undefined });
    }
  }

  const commitMessages = repositoryCommitMessages();
  for (const { commit, message } of commitMessages) {
    for (const finding of scanText(`git-message:${commit}`, message)) {
      findings.push({ ...finding, line: undefined });
    }
  }

  const annotatedTags = repositoryAnnotatedTags();
  for (const { objectId, contents } of annotatedTags) {
    for (const finding of scanText(`git-tag:${objectId}`, contents)) {
      findings.push({ ...finding, line: undefined });
    }
  }

  if (findings.length > 0) {
    console.error("[repository-secret-scan] possible credentials found (values redacted):");
    for (const finding of aggregateFindings(findings)) {
      const location = finding.line == null
        ? finding.file
        : `${finding.file}:${finding.line}`;
      const count = finding.occurrences > 1
        ? ` (${finding.occurrences} occurrences)`
        : "";
      console.error(`- ${finding.category}: ${location}${count} [REDACTED]`);
    }
    console.error("Remove the value from the tracked tree, rotate it at the provider, and review Git history.");
    process.exitCode = 1;
    return;
  }

  console.log(
    `[repository-secret-scan] passed (${files.length} tracked or untracked files; ${historyCommits.length} commits; ${annotatedTags.length} annotated tags)`
  );
}

const directRun = process.argv[1]
  ? import.meta.url === pathToFileURL(resolve(process.argv[1])).href
  : false;

if (directRun) main();
