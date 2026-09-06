import { describe, expect, it } from "vitest";
import { buildLifecycleCareDigest } from "@/lib/amora/careMessageIdentity";
import { buildAmoraInitialGreetingRequestKey } from "@/lib/ai/amoraInitialGreetingKey";

const scope = {
  actorId: "00000000-0000-4000-8000-000000000001",
  coupleId: "10000000-0000-4000-8000-000000000001",
  visibility: "shared" as const,
  resetAt: "2026-07-15T00:00:00.000Z",
};

describe("reset greeting request identity", () => {
  it("preserves the existing greeting claim when there is no reset", () => {
    expect(buildAmoraInitialGreetingRequestKey({ ...scope, resetAt: null }))
      .toBe(`greeting:${scope.actorId}`);
  });

  it("retries the same reset with the existing lifecycle SQL key shape", () => {
    const first = buildAmoraInitialGreetingRequestKey(scope);
    expect(first).toMatch(/^lifecycle:[0-9a-f]{64}$/);
    expect(buildAmoraInitialGreetingRequestKey({ ...scope })).toBe(first);
  });

  it.each([
    { actorId: "00000000-0000-4000-8000-000000000002" },
    { coupleId: "10000000-0000-4000-8000-000000000002" },
    { visibility: "bride_private" as const },
    { resetAt: "2026-07-16T00:00:00.000Z" },
  ])("separates each verified reset scope %j", (change) => {
    expect(buildAmoraInitialGreetingRequestKey({ ...scope, ...change }))
      .not.toBe(buildAmoraInitialGreetingRequestKey(scope));
  });

  it("does not reuse proactive lifecycle care identity", () => {
    const proactive = `lifecycle:${buildLifecycleCareDigest(scope.coupleId, scope.resetAt)}`;
    expect(buildAmoraInitialGreetingRequestKey(scope)).not.toBe(proactive);
  });
});
