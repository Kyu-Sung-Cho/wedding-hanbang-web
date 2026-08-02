import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const API_ROOT = dirname(fileURLToPath(import.meta.url));
const DIRECT_BUFFERING_RE = /\bawait\s+\(?\s*([A-Za-z_$][\w$]*)\.(?:json|text|arrayBuffer|formData|blob)\s*\(/gu;
const SAFE_NON_REQUEST_READS = new Map<string, ReadonlySet<string>>([
  // `data` is the size-checked Blob returned by Supabase Storage, not the HTTP request.
  ["admin/price/[id]/source/route.ts", new Set(["data"])],
  // These are bounded Storage/download or 64-byte Range response bodies.
  ["community/upload/finalize/route.ts", new Set(["data", "response"])],
]);

function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return routeFiles(path);
    return entry.name === "route.ts" ? [path] : [];
  });
}

describe("API request body limit fence", () => {
  it("does not directly buffer any request body", () => {
    const violations = routeFiles(API_ROOT).flatMap((path) => {
      const route = relative(API_ROOT, path).replaceAll("\\", "/");
      const source = readFileSync(path, "utf8");
      const safeReceivers = SAFE_NON_REQUEST_READS.get(route);
      const hasAwaitedBufferingCall = [...source.matchAll(DIRECT_BUFFERING_RE)]
        .some((match) => !safeReceivers?.has(match[1]));
      const hasDirectNamedRequestCall = /\b(?:request|req)\.(?:json|text|arrayBuffer|formData|blob)\s*\(/u
        .test(source);

      return hasAwaitedBufferingCall || hasDirectNamedRequestCall ? [route] : [];
    });

    expect(violations).toEqual([]);
  });
});
