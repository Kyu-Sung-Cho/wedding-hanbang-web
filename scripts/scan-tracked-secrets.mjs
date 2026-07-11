import { execFileSync } from "node:child_process";
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
    name: "Kakao platform key",
    regex: /(?:REST API|네이티브 앱|JavaScript|Admin|어드민)[^\r\n]{0,24}키\s*[:=]\s*[0-9a-f]{32}\b/gi,
  },
  {
    name: "credential-bearing service URL",
    regex: /\b(?:postgres|mysql|mongodb|redis):\/\/[^\s/:]+:[^\s/@]+@/gi,
  },
];

const placeholderWords = /(?:test|fake|example|placeholder|changeme|your[_-]?)/i;

function lineNumberAt(text, index) {
  let line = 1;
  for (let offset = 0; offset < index; offset += 1) {
    if (text.charCodeAt(offset) === 10) line += 1;
  }
  return line;
}

function trackedFiles() {
  const output = execFileSync("git", ["ls-files", "-z"], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  return output.split("\0").filter(Boolean);
}

export function scanText(file, text) {
  const findings = [];
  for (const pattern of patterns) {
    pattern.regex.lastIndex = 0;
    for (const match of text.matchAll(pattern.regex)) {
      const candidate = match[0];
      if (placeholderWords.test(candidate)) continue;
      findings.push({
        category: pattern.name,
        file,
        line: lineNumberAt(text, match.index ?? 0),
      });
    }
  }
  return findings;
}

function main() {
  const files = trackedFiles();
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

  if (findings.length > 0) {
    console.error("[tracked-secret-scan] possible credentials found (values redacted):");
    for (const finding of findings) {
      console.error(`- ${finding.category}: ${finding.file}:${finding.line} [REDACTED]`);
    }
    console.error("Remove the value from the tracked tree, rotate it at the provider, and review Git history.");
    process.exitCode = 1;
    return;
  }

  console.log(`[tracked-secret-scan] passed (${files.length} tracked files, current tree)`);
}

const directRun = process.argv[1]
  ? import.meta.url === pathToFileURL(resolve(process.argv[1])).href
  : false;

if (directRun) main();
