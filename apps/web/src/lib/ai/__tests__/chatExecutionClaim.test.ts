import { afterEach, describe, expect, it, vi } from "vitest";
import { createChatRequestIdentity } from "../chatExecutionClaim";

describe("createChatRequestIdentity", () => {
  process.env.AMORA_IDEMPOTENCY_SECRET = "test-only-idempotency-secret-32-bytes-minimum";
  const base = { userId: "u1", coupleId: "c1", clientRequestId: "r1" };

  afterEach(() => {
    process.env.AMORA_IDEMPOTENCY_SECRET = "test-only-idempotency-secret-32-bytes-minimum";
    vi.unstubAllEnvs();
  });

  it("is stable across object key order without storing raw payload", () => {
    const first = createChatRequestIdentity({
      ...base,
      payload: { messages: [{ role: "user", content: "예산" }], visibility: "shared" },
    });
    const second = createChatRequestIdentity({
      ...base,
      payload: { visibility: "shared", messages: [{ content: "예산", role: "user" }] },
    });
    expect(first).toEqual(second);
    expect(first.requestKey).toMatch(/^[a-f0-9]{64}$/);
    expect(first.requestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(first)).not.toContain("예산");
  });

  it("changes for a different user, request ID, or payload", () => {
    const original = createChatRequestIdentity({ ...base, payload: { value: 1 } });
    expect(createChatRequestIdentity({ ...base, userId: "u2", payload: { value: 1 } })).not.toEqual(original);
    expect(createChatRequestIdentity({ ...base, clientRequestId: "r2", payload: { value: 1 } })).not.toEqual(original);
    expect(createChatRequestIdentity({ ...base, payload: { value: 2 } })).not.toEqual(original);
  });

  it("does not couple production request identity to the service-role key", () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.AMORA_IDEMPOTENCY_SECRET;
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-fallback-that-is-long-enough-for-tests";

    expect(() => createChatRequestIdentity({ ...base, payload: {} })).toThrow(
      "전용 AMORA_IDEMPOTENCY_SECRET"
    );
  });

  it("rejects the long placeholder from the example environment", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.AMORA_IDEMPOTENCY_SECRET = "replace-with-at-least-32-random-characters";

    expect(() => createChatRequestIdentity({ ...base, payload: {} })).toThrow(
      "AMORA_IDEMPOTENCY_SECRET"
    );
  });
});
