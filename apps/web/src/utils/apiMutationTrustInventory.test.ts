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

const TRUST_GUARD_DELEGATES = [
  {
    functionName: "prepareDecisionMutation",
    importSource: "@/lib/community/decisionThreadApi",
    file: resolve(HERE, "../lib/community/decisionThreadApi.ts"),
  },
  {
    functionName: "prepareResponderMutation",
    importSource: "@/lib/community/responderSupplyApi",
    file: resolve(HERE, "../lib/community/responderSupplyApi.ts"),
  },
] as const;

const PROVIDER_REVIEW_HANDLER = {
  name: "reviewProvider",
  importSource: "@/lib/providers/handlers",
  file: resolve(HERE, "../lib/providers/handlers.ts"),
  accountFile: resolve(HERE, "../lib/providers/api.ts"),
} as const;

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

function exportedAsyncFunction(source: string, functionName: string): string {
  const start = source.indexOf(`export async function ${functionName}`);
  expect(start, `${functionName} must remain exported`).toBeGreaterThanOrEqual(0);
  const nextExport = source.indexOf("\nexport ", start + 1);
  return source.slice(start, nextExport >= 0 ? nextExport : source.length);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function namedImportPattern(imported: string, source: string): RegExp {
  return new RegExp(
    `import\\s*\\{[^}]*\\b${escapeRegExp(imported)}\\b[^}]*\\}\\s*from\\s*["']${escapeRegExp(source)}["']`,
    "u",
  );
}

function privilegedBoundaryIndexes(source: string): number[] {
  return [
    source.search(/createClientFromRequest\s*\(/),
    source.search(/createAdminClient\s*\(/),
    source.search(/verifyAdmin\s*\(/),
    source.search(/getServiceClient\s*\(/),
    source.search(/checkCommunityWriteAccess\s*\(/),
    source.search(/checkRateLimit(?:Persistent)?\s*\(/),
    source.search(/preflightResponderCommand\s*\(/),
    source.search(/hasDurableMutationReceipt\s*\(/),
    source.search(/reserveAmoraTurn\s*\(/),
    source.search(/createOpenAIResponseWithAudit\s*\(/),
    source.search(/readBoundedUtf8Text\s*\(/),
    source.search(/readResponderJsonObject\s*\(/),
    source.search(/\.(?:json|text|formData|rpc|from)\s*\(/),
  ].filter((index) => index >= 0);
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
      const directGuard = mutation.source.indexOf("isTrustedMutationRequest(");
      // This thin route returns the handler's response, rather than an ok/response
      // preflight union. Verify the complete call chain and the literal mutation flag.
      if (directGuard < 0 && mutation.source.includes(`${PROVIDER_REVIEW_HANDLER.name}(`)) {
        expect(mutation.fullSource).toMatch(namedImportPattern(PROVIDER_REVIEW_HANDLER.name, PROVIDER_REVIEW_HANDLER.importSource));
        const forwarded = /return\s+(?:await\s+)?reviewProvider\(\s*request\s*,\s*id\s*\)\s*;/u.exec(mutation.source);
        expect(forwarded, `${key} must return the guarded handler response`).not.toBeNull();
        if (!forwarded) return;
        for (const boundary of privilegedBoundaryIndexes(mutation.source)) expect(forwarded.index).toBeLessThan(boundary);

        const handlerSource = readFileSync(PROVIDER_REVIEW_HANDLER.file, "utf8");
        expect(handlerSource).toMatch(namedImportPattern("providerAccount", "./api"));
        const handler = exportedAsyncFunction(handlerSource, PROVIDER_REVIEW_HANDLER.name);
        const accountCall = handler.search(/await\s+providerAccount\(\s*request\s*,\s*true\s*,\s*true\s*\)/u);
        expect(accountCall, "review handler must require mutation trust and administrator access").toBeGreaterThanOrEqual(0);
        for (const boundary of [
          ...privilegedBoundaryIndexes(handler),
          ...[...handler.matchAll(/\b(?:providerBody|providerRateLimit|providerRpc)\s*\(/gu)].map((match) => match.index),
        ]) expect(accountCall).toBeLessThan(boundary);

        const accountSource = readFileSync(PROVIDER_REVIEW_HANDLER.accountFile, "utf8");
        expect(accountSource).toMatch(namedImportPattern("isTrustedMutationRequest", "@/utils/trustedMutation"));
        const account = exportedAsyncFunction(accountSource, "providerAccount");
        const rejection = /if\s*\(\s*mutation\s*&&\s*!isTrustedMutationRequest\(\s*request\s*\)\s*\)\s*throw\s+new\s+ProviderError\(\s*["']UNTRUSTED_ORIGIN["']\s*,\s*403\s*,/u.exec(account);
        expect(rejection, "account helper must reject untrusted mutations with 403").not.toBeNull();
        if (!rejection) return;
        for (const boundary of privilegedBoundaryIndexes(account)) expect(rejection.index).toBeLessThan(boundary);
        return;
      }
      const delegate = TRUST_GUARD_DELEGATES.find(({ functionName }) =>
        mutation.source.includes(`${functionName}(`),
      );
      let guard = directGuard;

      if (directGuard >= 0) {
        expect(mutation.fullSource).toContain(
          'import { isTrustedMutationRequest } from "@/utils/trustedMutation"',
        );
        expect(mutation.source).toMatch(/(?:status:\s*403|,\s*403\))/);
      } else {
        expect(delegate, `${key} must use a registered trust guard delegate`).toBeDefined();
        if (!delegate) return;

        expect(mutation.fullSource).toMatch(
          namedImportPattern(delegate.functionName, delegate.importSource),
        );
        const delegateCall = new RegExp(
          `const\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*await\\s+${escapeRegExp(delegate.functionName)}\\s*\\(`,
          "u",
        ).exec(mutation.source);
        expect(delegateCall, `${key} must await the trust guard delegate`).not.toBeNull();
        if (!delegateCall) return;

        const binding = delegateCall[1];
        expect(binding).toBeDefined();
        if (!binding) return;

        const afterCallOffset = delegateCall.index + delegateCall[0].length;
        const rejection = new RegExp(
          `if\\s*\\(\\s*!${escapeRegExp(binding)}\\.ok\\s*\\)\\s*(?:\\{\\s*)?return\\s+${escapeRegExp(binding)}\\.response\\s*;`,
          "u",
        ).exec(mutation.source.slice(afterCallOffset));
        expect(
          rejection,
          `${key} must return a rejected delegate response`,
        ).not.toBeNull();
        if (!rejection) return;
        guard = afterCallOffset + rejection.index + rejection[0].length;

        const delegateSource = readFileSync(delegate.file, "utf8");
        const delegateFunction = exportedAsyncFunction(
          delegateSource,
          delegate.functionName,
        );
        const delegateGuard = delegateFunction.search(
          /if\s*\(\s*!isTrustedMutationRequest\(\s*request\s*\)\s*\)/u,
        );
        expect(delegateSource).toMatch(
          namedImportPattern(
            "isTrustedMutationRequest",
            "@/utils/trustedMutation",
          ),
        );
        expect(delegateGuard).toBeGreaterThanOrEqual(0);
        expect(delegateFunction).toMatch(
          /(?:status:\s*403|,\s*403,?\s*\))/,
        );
        for (const boundary of privilegedBoundaryIndexes(delegateFunction)) {
          expect(delegateGuard).toBeLessThan(boundary);
        }
      }

      expect(guard).toBeGreaterThanOrEqual(0);
      for (const boundary of privilegedBoundaryIndexes(mutation.source)) {
        expect(guard).toBeLessThan(boundary);
      }
    });
  }

  it("keeps every exception registered and prevents silent stale exemptions", () => {
    expect([...seenExemptions].sort()).toEqual([...EXEMPT_MUTATIONS.keys()].sort());
  });
});
