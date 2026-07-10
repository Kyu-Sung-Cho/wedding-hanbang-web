import { describe, expect, it } from "vitest";
import { createToolExecutionKey } from "../toolExecutionClaim";

const base = {
  userId: "user-a",
  coupleId: "couple-a",
  clientRequestId: "request-a",
  visibility: "shared" as const,
  toolName: "update_budget",
  occurrence: 0,
};

describe("createToolExecutionKey", () => {
  it("is stable when object key order changes", () => {
    const first = createToolExecutionKey({
      ...base,
      toolInput: { total_budget: 50_000_000, nested: { b: 2, a: 1 } },
    });
    const second = createToolExecutionKey({
      ...base,
      toolInput: { nested: { a: 1, b: 2 }, total_budget: 50_000_000 },
    });
    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });

  it("separates users, visibility, inputs, and repeated identical calls", () => {
    const original = createToolExecutionKey({ ...base, toolInput: { total_budget: 1 } });
    expect(createToolExecutionKey({ ...base, userId: "user-b", toolInput: { total_budget: 1 } })).not.toBe(original);
    expect(createToolExecutionKey({ ...base, visibility: "bride_private", toolInput: { total_budget: 1 } })).not.toBe(original);
    expect(createToolExecutionKey({ ...base, toolInput: { total_budget: 2 } })).not.toBe(original);
    expect(createToolExecutionKey({ ...base, occurrence: 1, toolInput: { total_budget: 1 } })).not.toBe(original);
  });
});
