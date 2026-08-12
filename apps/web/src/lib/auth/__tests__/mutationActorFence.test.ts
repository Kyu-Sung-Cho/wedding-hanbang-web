import { describe, expect, it } from "vitest";

import {
  verifyMutationActorFence,
} from "@/lib/auth/mutationActorFence";
import {
  HANBANG_EXPECTED_ACTOR_USER_ID_HEADER,
  HANBANG_MUTATION_CONTRACT_VERSION,
  HANBANG_MUTATION_CONTRACT_VERSION_HEADER,
} from "@hanbang/shared";

const ACTOR_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_ID = "20000000-0000-4000-8000-000000000002";

function headers(values: Record<string, string> = {}) {
  return new Headers(values);
}

describe("mutation actor rollout fence", () => {
  it("temporarily accepts a headerless legacy caller during Phase A", () => {
    expect(verifyMutationActorFence(headers(), ACTOR_ID)).toEqual({
      ok: true,
      contract: "legacy",
    });
  });

  it("can reject a headerless caller for destructive mutations", () => {
    expect(verifyMutationActorFence(headers(), ACTOR_ID, {
      allowLegacy: false,
    })).toMatchObject({
      ok: false,
      status: 400,
      code: "MUTATION_ACTOR_CONTRACT_INVALID",
    });
  });

  it("accepts v2 only when the initiating actor matches the bearer", () => {
    expect(verifyMutationActorFence(headers({
      [HANBANG_MUTATION_CONTRACT_VERSION_HEADER]: HANBANG_MUTATION_CONTRACT_VERSION,
      [HANBANG_EXPECTED_ACTOR_USER_ID_HEADER]: ACTOR_ID.toUpperCase(),
    }), ACTOR_ID)).toEqual({ ok: true, contract: "v2" });
  });

  it("fails closed for a missing, malformed, or mismatched v2 actor", () => {
    const version = {
      [HANBANG_MUTATION_CONTRACT_VERSION_HEADER]: HANBANG_MUTATION_CONTRACT_VERSION,
    };
    expect(verifyMutationActorFence(headers(version), ACTOR_ID)).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(verifyMutationActorFence(headers({
      ...version,
      [HANBANG_EXPECTED_ACTOR_USER_ID_HEADER]: "not-a-user-id",
    }), ACTOR_ID)).toMatchObject({ ok: false, status: 400 });
    expect(verifyMutationActorFence(headers({
      ...version,
      [HANBANG_EXPECTED_ACTOR_USER_ID_HEADER]: OTHER_ID,
    }), ACTOR_ID)).toMatchObject({
      ok: false,
      status: 409,
      code: "MUTATION_ACTOR_CHANGED",
    });
  });

  it("rejects partial and unknown contracts instead of guessing", () => {
    expect(verifyMutationActorFence(headers({
      [HANBANG_EXPECTED_ACTOR_USER_ID_HEADER]: ACTOR_ID,
    }), ACTOR_ID)).toMatchObject({ ok: false, status: 400 });
    expect(verifyMutationActorFence(headers({
      [HANBANG_MUTATION_CONTRACT_VERSION_HEADER]: "3",
      [HANBANG_EXPECTED_ACTOR_USER_ID_HEADER]: ACTOR_ID,
    }), ACTOR_ID)).toMatchObject({ ok: false, status: 400 });
  });
});
