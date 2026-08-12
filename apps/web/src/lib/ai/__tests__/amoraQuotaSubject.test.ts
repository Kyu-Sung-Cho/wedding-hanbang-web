import { describe, expect, it } from "vitest";
import { deriveAmoraQuotaSubjectId } from "../amoraQuotaSubject";

const COUPLE_ID = "11111111-1111-4111-8111-111111111111";
const BRIDE_ID = "22222222-2222-4222-8222-222222222222";
const GROOM_ID = "33333333-3333-4333-8333-333333333333";

describe("deriveAmoraQuotaSubjectId", () => {
  it("uses one stable shared quota subject for both members", () => {
    const bride = deriveAmoraQuotaSubjectId({
      coupleId: COUPLE_ID,
      actorUserId: BRIDE_ID,
      visibility: "shared",
    });
    const groom = deriveAmoraQuotaSubjectId({
      coupleId: COUPLE_ID,
      actorUserId: GROOM_ID,
      visibility: "shared",
    });

    expect(bride).toBe(groom);
    expect(bride).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("isolates each member's private quota from the partner and shared lane", () => {
    const shared = deriveAmoraQuotaSubjectId({
      coupleId: COUPLE_ID,
      actorUserId: BRIDE_ID,
      visibility: "shared",
    });
    const bridePrivate = deriveAmoraQuotaSubjectId({
      coupleId: COUPLE_ID,
      actorUserId: BRIDE_ID,
      visibility: "bride_private",
    });
    const groomPrivate = deriveAmoraQuotaSubjectId({
      coupleId: COUPLE_ID,
      actorUserId: GROOM_ID,
      visibility: "groom_private",
    });

    expect(new Set([shared, bridePrivate, groomPrivate])).toHaveLength(3);
  });

  it("binds a private subject to the actor, not to a client-provided role label", () => {
    const brideLane = deriveAmoraQuotaSubjectId({
      coupleId: COUPLE_ID,
      actorUserId: BRIDE_ID,
      visibility: "bride_private",
    });
    const forgedLane = deriveAmoraQuotaSubjectId({
      coupleId: COUPLE_ID,
      actorUserId: BRIDE_ID,
      visibility: "groom_private",
    });

    expect(forgedLane).toBe(brideLane);
  });

  it("rejects malformed durable identities instead of creating an unmetered key", () => {
    expect(() => deriveAmoraQuotaSubjectId({
      coupleId: "not-a-uuid",
      actorUserId: BRIDE_ID,
      visibility: "shared",
    })).toThrow(/valid UUID/i);
  });
});
