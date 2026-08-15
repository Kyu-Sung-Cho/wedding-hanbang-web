import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));

const CORE_COOKIE_MUTATIONS = [
  { file: "../app/api/couple/reset/route.ts", verbs: ["POST"] },
  { file: "../app/api/couple/link/route.ts", verbs: ["POST"] },
  { file: "../app/api/chat/clear-request/route.ts", verbs: ["POST"] },
  { file: "../app/api/chat/check-couple-conflict/route.ts", verbs: ["POST"] },
  { file: "../app/api/chat/feedback/route.ts", verbs: ["POST"] },
  { file: "../app/api/chat/image-urls/route.ts", verbs: ["POST"] },
  { file: "../app/api/amora/mediation/accept/route.ts", verbs: ["POST", "DELETE"] },
  { file: "../app/api/amora/memory/route.ts", verbs: ["PATCH"] },
  { file: "../app/api/amora/actions/route.ts", verbs: ["POST"] },
  { file: "../app/api/amora/actions/[id]/route.ts", verbs: ["PATCH"] },
  { file: "../app/api/couple/code/route.ts", verbs: ["POST"] },
  { file: "../app/api/messages/route.ts", verbs: ["POST"] },
  { file: "../app/api/money/route.ts", verbs: ["POST"] },
  { file: "../app/api/money/[id]/route.ts", verbs: ["PATCH", "DELETE"] },
  { file: "../app/api/profile/route.ts", verbs: ["PATCH"] },
  { file: "../app/api/settings/wedding-profile/route.ts", verbs: ["PATCH"] },
  { file: "../app/api/auth/delete/route.ts", verbs: ["DELETE"] },
  { file: "../app/api/auth/password/route.ts", verbs: ["PATCH"] },
  { file: "../app/api/journey/route.ts", verbs: ["PATCH"] },
  { file: "../app/api/bookings/[id]/inquiry-handoff/route.ts", verbs: ["PATCH"] },
  { file: "../app/api/amora/couple-criterion/route.ts", verbs: ["POST", "PATCH", "DELETE"] },
  { file: "../app/api/events/route.ts", verbs: ["POST"] },
  { file: "../app/api/community/upload/route.ts", verbs: ["POST"] },
  { file: "../app/api/community/upload/finalize/route.ts", verbs: ["POST"] },
  { file: "../app/api/vendors/[id]/photos/route.ts", verbs: ["POST"] },
  { file: "../app/api/admin/enrich/[id]/assign/route.ts", verbs: ["POST"] },
  { file: "../app/api/admin/enrich/[id]/route.ts", verbs: ["PATCH"] },
  { file: "../app/api/admin/posts/[id]/moderate/route.ts", verbs: ["POST"] },
  { file: "../app/api/admin/posts/[id]/pin/route.ts", verbs: ["PATCH"] },
  { file: "../app/api/admin/price/[id]/route.ts", verbs: ["PATCH"] },
  { file: "../app/api/admin/price/dedupe/[id]/route.ts", verbs: ["PATCH"] },
  { file: "../app/api/admin/price/snapshots/route.ts", verbs: ["POST"] },
  { file: "../app/api/admin/price/upload/confirmations/[id]/route.ts", verbs: ["PATCH"] },
  { file: "../app/api/admin/price/upload/route.ts", verbs: ["POST"] },
  { file: "../app/api/admin/reports/[id]/route.ts", verbs: ["PATCH"] },
  { file: "../app/api/admin/vendors/[id]/route.ts", verbs: ["PATCH"] },
  { file: "../app/api/community/cohort/auto-assign/route.ts", verbs: ["POST"] },
  { file: "../app/api/community/cohort/route.ts", verbs: ["POST"] },
  { file: "../app/api/community/profile/route.ts", verbs: ["POST", "PATCH"] },
  { file: "../app/api/community/profile/wedding-date/route.ts", verbs: ["POST"] },
  { file: "../app/api/community/cohort/[id]/contracts/route.ts", verbs: ["POST"] },
  { file: "../app/api/community/cohort/[id]/members/[userId]/report/route.ts", verbs: ["POST"] },
  { file: "../app/api/community/cohort/[id]/messages/route.ts", verbs: ["POST"] },
  { file: "../app/api/community/cohort/[id]/timeline/route.ts", verbs: ["POST"] },
  { file: "../app/api/community/comments/[id]/route.ts", verbs: ["PATCH", "DELETE"] },
  { file: "../app/api/community/posts/route.ts", verbs: ["POST"] },
  { file: "../app/api/community/posts/[id]/route.ts", verbs: ["PATCH", "DELETE"] },
  { file: "../app/api/community/posts/[id]/report/route.ts", verbs: ["POST"] },
  { file: "../app/api/community/comments/[id]/vote/route.ts", verbs: ["POST"] },
  { file: "../app/api/community/polls/[pollId]/vote/route.ts", verbs: ["POST"] },
  { file: "../app/api/community/posts/[id]/bookmark/route.ts", verbs: ["POST"] },
  { file: "../app/api/community/posts/[id]/vote/route.ts", verbs: ["POST"] },
  { file: "../app/api/community/posts/[id]/view/route.ts", verbs: ["POST"] },
  { file: "../app/api/community/ai-comment/route.ts", verbs: ["POST"] },
  { file: "../app/api/community/wedding-court/[caseId]/vote/route.ts", verbs: ["POST"] },
] as const;

const DEFENSE_IN_DEPTH_ROUTES = new Set([
  "../app/api/admin/enrich/[id]/assign/route.ts",
  "../app/api/admin/enrich/[id]/route.ts",
  "../app/api/admin/posts/[id]/moderate/route.ts",
  "../app/api/admin/posts/[id]/pin/route.ts",
  "../app/api/admin/price/[id]/route.ts",
  "../app/api/admin/price/dedupe/[id]/route.ts",
  "../app/api/admin/price/snapshots/route.ts",
  "../app/api/admin/price/upload/confirmations/[id]/route.ts",
  "../app/api/admin/price/upload/route.ts",
  "../app/api/admin/reports/[id]/route.ts",
  "../app/api/admin/vendors/[id]/route.ts",
  "../app/api/community/cohort/auto-assign/route.ts",
  "../app/api/community/cohort/route.ts",
  "../app/api/community/profile/route.ts",
  "../app/api/community/profile/wedding-date/route.ts",
  "../app/api/community/cohort/[id]/contracts/route.ts",
  "../app/api/community/cohort/[id]/members/[userId]/report/route.ts",
  "../app/api/community/cohort/[id]/messages/route.ts",
  "../app/api/community/cohort/[id]/timeline/route.ts",
  "../app/api/community/comments/[id]/route.ts",
  "../app/api/community/posts/route.ts",
  "../app/api/community/posts/[id]/route.ts",
  "../app/api/community/posts/[id]/report/route.ts",
  "../app/api/community/comments/[id]/vote/route.ts",
  "../app/api/community/polls/[pollId]/vote/route.ts",
  "../app/api/community/posts/[id]/bookmark/route.ts",
  "../app/api/community/posts/[id]/vote/route.ts",
  "../app/api/community/posts/[id]/view/route.ts",
  "../app/api/community/ai-comment/route.ts",
  "../app/api/community/wedding-court/[caseId]/vote/route.ts",
]);

function handlerSource(source: string, verb: string): string {
  const start = source.indexOf(`export async function ${verb}`);
  if (start < 0) return "";
  const next = source.indexOf("export async function ", start + 1);
  return source.slice(start, next < 0 ? undefined : next);
}

describe("core authenticated mutation trust boundary", () => {
  for (const route of CORE_COOKIE_MUTATIONS) {
    for (const verb of route.verbs) {
      it(`${verb} ${route.file} rejects untrusted origin before auth or body parsing`, () => {
        const source = readFileSync(resolve(HERE, route.file), "utf8");
        const handler = handlerSource(source, verb);
        expect(source).toContain("isTrustedMutationRequest");
        expect(handler).not.toBe("");

        const guard = handler.indexOf("isTrustedMutationRequest(");
        const privilegedBoundaries = [
          handler.search(/createClientFromRequest\s*\(/),
          handler.search(/verifyAdmin\s*\(/),
          handler.search(/getServiceClient\s*\(/),
          handler.search(/checkRateLimit(?:Persistent)?\s*\(/),
          handler.search(/reserveAmoraTurn\s*\(/),
          handler.search(/\.(?:json|text|formData)\s*\(/),
        ].filter((index) => index >= 0);
        expect(guard).toBeGreaterThanOrEqual(0);
        for (const boundary of privilegedBoundaries) {
          expect(guard).toBeLessThan(boundary);
        }
        expect(handler).toMatch(/(?:status:\s*403|,\s*403\))/);
        if (DEFENSE_IN_DEPTH_ROUTES.has(route.file)) {
          expect(source).toContain("no-store");
        }
      });
    }
  }
});
