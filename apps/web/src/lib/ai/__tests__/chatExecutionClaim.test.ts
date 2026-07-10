import { describe, expect, it } from "vitest";
import { createChatRequestIdentity } from "../chatExecutionClaim";

describe("createChatRequestIdentity", () => {
  process.env.AMORA_IDEMPOTENCY_SECRET = "test-only-idempotency-secret-32-bytes-minimum";
  const base = { userId: "u1", coupleId: "c1", clientRequestId: "r1" };

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
});
