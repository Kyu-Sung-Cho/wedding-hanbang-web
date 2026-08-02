import { describe, expect, it } from "vitest";

import {
  AMORA_W3_PRIOR_ASSISTANT_MAX_CHARS,
  AMORA_W3_PRIOR_USER_MAX_CHARS,
  buildAmoraBoundedW3Continuity,
  hasExplicitAmoraW3ContinuityReference,
  type AmoraBoundedContinuityRow,
} from "@/lib/ai/amoraBoundedContinuity";

const CURRENT_ID = "30000000-0000-4000-8000-000000000003";
const ASSISTANT_ID = "30000000-0000-4000-8000-000000000002";
const PRIOR_ID = "30000000-0000-4000-8000-000000000001";
const USER_ID = "10000000-0000-4000-8000-000000000001";
const SEGMENT_ID = "60000000-0000-4000-8000-000000000001";

function rows(): AmoraBoundedContinuityRow[] {
  return [
    {
      id: CURRENT_ID,
      sender_id: USER_ID,
      sender_type: "bride",
      role: "user",
      content: "그게 너무 속상해",
      metadata: null,
      visibility: "shared",
      segment_id: SEGMENT_ID,
    },
    {
      id: ASSISTANT_ID,
      sender_id: null,
      sender_type: "ai",
      role: "assistant",
      content: "예식장 계약 조건을 다시 확인해볼 수 있어요.",
      metadata: { in_reply_to_user_message_id: PRIOR_ID },
      visibility: "shared",
      segment_id: SEGMENT_ID,
    },
    {
      id: PRIOR_ID,
      sender_id: USER_ID,
      sender_type: "bride",
      role: "user",
      content: "예식장 계약 때문에 파트너와 의견이 달라요",
      metadata: null,
      visibility: "shared",
      segment_id: SEGMENT_ID,
    },
  ];
}

function build(overrides: Partial<Parameters<
  typeof buildAmoraBoundedW3Continuity
>[0]> = {}) {
  return buildAmoraBoundedW3Continuity({
    newestFirstRows: rows(),
    currentMessageId: CURRENT_ID,
    currentUserText: "그게 너무 속상해",
    requesterUserId: USER_ID,
    visibility: "shared",
    segmentId: SEGMENT_ID,
    ...overrides,
  });
}

describe("Amora bounded W3 continuity", () => {
  it.each([
    "그것도 마음에 걸려",
    "그거 때문에 힘들어",
    "그게 너무 속상해",
    "그걸 다시 말하기 싫어",
    "그 일은 아직 힘들어",
    "그 문제 때문에 지쳤어",
    "그 얘기가 계속 생각나",
    "그 말이 서운해",
    "아까 너무 당황했어",
    "방금 마음이 복잡해졌어",
    "앞에서 말한 게 속상해",
    "그래서 오늘 힘들어",
    "그 때문에 마음이 무거워",
  ])("recognizes the explicit reference marker in %s", (text) => {
    expect(hasExplicitAmoraW3ContinuityReference(text)).toBe(true);
  });

  it.each(["그 사람 때문에 힘들어", "요즘 힘들어", "일 때문에 지쳤어"])(
    "does not treat %s as a bounded reference",
    (text) => {
      expect(hasExplicitAmoraW3ContinuityReference(text)).toBe(false);
    },
  );

  it("returns only the linked prior exchange and current user turn", () => {
    expect(build()).toEqual([
      { role: "user", content: "예식장 계약 때문에 파트너와 의견이 달라요" },
      { role: "assistant", content: "예식장 계약 조건을 다시 확인해볼 수 있어요." },
      { role: "user", content: "그게 너무 속상해" },
    ]);
  });

  it("also accepts a wedding-adjacent W1 prior turn", () => {
    const candidate = rows();
    candidate[2] = {
      ...candidate[2]!,
      content: "신혼집 이사 비용 때문에 부부 재정을 어떻게 나눌지 대화하고 싶어",
    };
    expect(build({ newestFirstRows: candidate })?.[0]).toEqual({
      role: "user",
      content: "신혼집 이사 비용 때문에 부부 재정을 어떻게 나눌지 대화하고 싶어",
    });
  });

  it("bounds both stored messages while preserving the current turn", () => {
    const candidate = rows();
    candidate[1]!.content = "답".repeat(2_000);
    candidate[2]!.content = `예식장 ${"계약".repeat(1_000)}`;
    const result = build({ newestFirstRows: candidate });

    expect(Array.from(result?.[0]?.content ?? "")).toHaveLength(
      AMORA_W3_PRIOR_USER_MAX_CHARS,
    );
    expect(Array.from(result?.[1]?.content ?? "")).toHaveLength(
      AMORA_W3_PRIOR_ASSISTANT_MAX_CHARS,
    );
    expect(result?.[2]?.content).toBe("그게 너무 속상해");
  });

  it.each([
    ["missing row", (value: AmoraBoundedContinuityRow[]) => value.slice(0, 2)],
    ["wrong current id", (value: AmoraBoundedContinuityRow[]) => {
      value[0] = { ...value[0]!, id: "30000000-0000-4000-8000-000000000099" };
      return value;
    }],
    ["wrong prior actor", (value: AmoraBoundedContinuityRow[]) => {
      value[2] = { ...value[2]!, sender_id: "10000000-0000-4000-8000-000000000099" };
      return value;
    }],
    ["mixed visibility", (value: AmoraBoundedContinuityRow[]) => {
      value[1] = { ...value[1]!, visibility: "bride_private" };
      return value;
    }],
    ["mixed conversation segment", (value: AmoraBoundedContinuityRow[]) => {
      value[2] = {
        ...value[2]!,
        segment_id: "60000000-0000-4000-8000-000000000099",
      };
      return value;
    }],
    ["partner-target row", (value: AmoraBoundedContinuityRow[]) => {
      value[1] = { ...value[1]!, metadata: { target: "partner" } };
      return value;
    }],
    ["missing reply binding", (value: AmoraBoundedContinuityRow[]) => {
      value[1] = { ...value[1]!, metadata: null };
      return value;
    }],
    ["wrong reply binding", (value: AmoraBoundedContinuityRow[]) => {
      value[1] = {
        ...value[1]!,
        metadata: { in_reply_to_user_message_id: CURRENT_ID },
      };
      return value;
    }],
  ])("rejects %s", (_label, mutate) => {
    expect(build({ newestFirstRows: mutate(rows()) })).toBeNull();
  });

  it.each([
    "예식장 계약금 환불을 법적으로 판단해줘",
    "요즘 너무 힘들어",
    "파이썬 코드를 작성해줘",
  ])("rejects unsafe or unrelated prior scope: %s", (content) => {
    const candidate = rows();
    candidate[2] = { ...candidate[2]!, content };
    expect(build({ newestFirstRows: candidate })).toBeNull();
  });

  it("rejects a current turn without an explicit reference", () => {
    const candidate = rows();
    candidate[0] = { ...candidate[0]!, content: "오늘 너무 속상해" };
    expect(build({
      newestFirstRows: candidate,
      currentUserText: "오늘 너무 속상해",
    })).toBeNull();
  });
});
