import { describe, expect, it } from "vitest";
import {
  COHORT_ASSIGNMENT_MAX_BODY_BYTES,
  readCohortAssignmentBody,
} from "@/lib/community/cohortAssignment";

describe("readCohortAssignmentBody", () => {
  it("accepts only the two strict integer fields", async () => {
    await expect(readCohortAssignmentBody(new Request("https://hanbang.ai/api/test", {
      method: "POST",
      body: JSON.stringify({ year: 2027, month: 4 }),
    }))).resolves.toEqual({ ok: true, year: 2027, month: 4 });

    await expect(readCohortAssignmentBody(new Request("https://hanbang.ai/api/test", {
      method: "POST",
      body: JSON.stringify({ year: "2027", month: 4 }),
    }))).resolves.toEqual({ ok: false, status: 400 });

    await expect(readCohortAssignmentBody(new Request("https://hanbang.ai/api/test", {
      method: "POST",
      body: JSON.stringify({ year: 2027, month: 4, userId: "other-user" }),
    }))).resolves.toEqual({ ok: false, status: 400 });
  });

  it("rejects malformed JSON", async () => {
    await expect(readCohortAssignmentBody(new Request("https://hanbang.ai/api/test", {
      method: "POST",
      body: "{",
    }))).resolves.toEqual({ ok: false, status: 400 });
  });

  it("enforces the byte limit when content-length is absent", async () => {
    const oversized = new Request("https://hanbang.ai/api/test", {
      method: "POST",
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode("x".repeat(COHORT_ASSIGNMENT_MAX_BODY_BYTES + 1)),
          );
          controller.close();
        },
      }),
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    expect(oversized.headers.get("content-length")).toBeNull();

    await expect(readCohortAssignmentBody(oversized)).resolves.toEqual({
      ok: false,
      status: 413,
    });
  });
});
