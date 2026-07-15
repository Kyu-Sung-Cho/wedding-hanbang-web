import { describe, expect, it } from "vitest";
import { GET as getCohort, POST as createCohort } from "@/app/api/community/cohort/route";
import { POST as autoAssignCohort } from "@/app/api/community/cohort/auto-assign/route";
import { GET as getMessages, POST as postMessage } from "@/app/api/community/cohort/[id]/messages/route";
import { GET as getTimeline, POST as postTimeline } from "@/app/api/community/cohort/[id]/timeline/route";
import { GET as getContracts, POST as postContract } from "@/app/api/community/cohort/[id]/contracts/route";
import { GET as getDigest } from "@/app/api/community/cohort/[id]/digest/route";
import { POST as reportMember } from "@/app/api/community/cohort/[id]/members/[userId]/report/route";
import { POST as updateWeddingDate } from "@/app/api/community/profile/wedding-date/route";
import { GET as getCohortProfile } from "@/app/api/community/profiles/[userId]/route";

describe("cohort feature retirement", () => {
  it("returns the same 410 response from every legacy method", async () => {
    const handlers = [
      getCohort,
      createCohort,
      autoAssignCohort,
      getMessages,
      postMessage,
      getTimeline,
      postTimeline,
      getContracts,
      postContract,
      getDigest,
      reportMember,
      updateWeddingDate,
      getCohortProfile,
    ] as const;

    for (const handler of handlers) {
      const response = await handler();
      expect(response.status).toBe(410);
      await expect(response.json()).resolves.toMatchObject({
        code: "cohort_rooms_retired",
      });
    }
  });
});
