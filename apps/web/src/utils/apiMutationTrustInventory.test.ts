import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const API_ROOT = resolve(HERE, "../app/api");
const INVENTORY_ROOTS = [
  resolve(API_ROOT, "admin"),
  resolve(API_ROOT, "community"),
];

const EXEMPT_MUTATIONS = new Map<
  string,
  { reason: string; evidence: readonly string[] }
>([
  [
    "admin/auth/route.ts#POST",
    {
      reason:
        "credential bootstrap/login uses an explicit server setup password and persistent IP rate limiting before privileged writes",
      evidence: ["ADMIN_PASSWORD", "checkRateLimitPersistent"],
    },
  ],
  [
    "community/ai-price-comment/route.ts#POST",
    {
      reason:
        "anonymous deterministic guidance is a public endpoint with persistent IP rate limiting; it does not mutate caller-owned state",
      evidence: ["buildSourceBackedPriceComment", "checkRateLimitPersistent"],
    },
  ],
]);

function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return routeFiles(path);
    return entry.isFile() && entry.name === "route.ts" ? [path] : [];
  });
}

function normalizedRoute(file: string): string {
  return relative(API_ROOT, file).replaceAll("\\", "/");
}

function mutationHandlers(source: string) {
  const starts = [...source.matchAll(/export async function (POST|PUT|PATCH|DELETE)\b/g)];
  return starts.map((match, index) => ({
    verb: match[1],
    source: source.slice(
      match.index,
      starts[index + 1]?.index ?? source.length,
    ),
  }));
}

const INVENTORY = INVENTORY_ROOTS.flatMap(routeFiles).flatMap((file) => {
  const source = readFileSync(file, "utf8");
  return mutationHandlers(source).map((handler) => ({
    ...handler,
    file,
    route: normalizedRoute(file),
    fullSource: source,
  }));
});

describe("admin/community mutation trust inventory", () => {
  const seenExemptions = new Set<string>();

  for (const mutation of INVENTORY) {
    const key = `${mutation.route}#${mutation.verb}`;
    const exemption = EXEMPT_MUTATIONS.get(key);

    if (exemption) {
      seenExemptions.add(key);
      it(`${key} remains an explicit public credential/anti-abuse exception`, () => {
        expect(exemption.reason.length).toBeGreaterThan(40);
        for (const evidence of exemption.evidence) {
          expect(mutation.source).toContain(evidence);
        }
      });
      continue;
    }

    it(`${key} rejects untrusted browser mutations before privileged work`, () => {
      const guard = mutation.source.indexOf("isTrustedMutationRequest(");
      expect(mutation.fullSource).toContain(
        'import { isTrustedMutationRequest } from "@/utils/trustedMutation"',
      );
      expect(guard).toBeGreaterThanOrEqual(0);
      expect(mutation.source).toMatch(/(?:status:\s*403|,\s*403\))/);

      const privilegedBoundaries = [
        mutation.source.search(/createClientFromRequest\s*\(/),
        mutation.source.search(/verifyAdmin\s*\(/),
        mutation.source.search(/getServiceClient\s*\(/),
        mutation.source.search(/checkRateLimit(?:Persistent)?\s*\(/),
        mutation.source.search(/reserveAmoraTurn\s*\(/),
        mutation.source.search(/createOpenAIResponseWithAudit\s*\(/),
        mutation.source.search(/\.(?:json|text|formData|rpc|from)\s*\(/),
      ].filter((index) => index >= 0);

      for (const boundary of privilegedBoundaries) {
        expect(guard).toBeLessThan(boundary);
      }
    });
  }

  it("keeps every exception registered and prevents silent stale exemptions", () => {
    expect([...seenExemptions].sort()).toEqual([...EXEMPT_MUTATIONS.keys()].sort());
  });
});
