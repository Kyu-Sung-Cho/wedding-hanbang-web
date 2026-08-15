import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  selectCurrentAmoraCoupleCriterion,
  selectCurrentAmoraCoupleCriterionSnapshot,
  selectCurrentAmoraCoreCriterion,
  withoutAmoraCoreCriterionReceipts,
} from "../amoraCoreCriterion";
import { getWeddingPlannerSystemPrompt } from "../prompts";

const OWNER = "11111111-1111-4111-8111-111111111111";
const PARTNER = "22222222-2222-4222-8222-222222222222";
const COUPLE = "33333333-3333-4333-8333-333333333333";

function criterionRow(
  value: string | null,
  options: {
    deleted?: boolean;
    ownerUserId?: string;
    visibility?: "bride_private" | "groom_private" | "shared";
  } = {},
) {
  return {
    category: "preference",
    decision_type: "considering",
    chosen_value: { value },
    source: "manual",
    visibility: options.visibility ?? "bride_private",
    metadata: {
      criterion_contract: "amora_core_criterion_v1",
      criterion_version: 1,
      owner_user_id: options.ownerUserId ?? OWNER,
      explicit: true,
      criterion_deleted: options.deleted ?? false,
    },
  };
}

describe("아모라 핵심 기준 채팅 투영", () => {
  it("최신 본인 비공개 영수증만 쓰고 최신 영수증이 삭제면 과거 기준을 되살리지 않는다", () => {
    expect(selectCurrentAmoraCoreCriterion({
      expectedOwnerUserId: OWNER,
      expectedVisibility: "bride_private",
      newestFirstRows: [
        criterionRow(null, { deleted: true }),
        criterionRow("우리 둘이 편안한 하루"),
        criterionRow("파트너 기준", {
          ownerUserId: "22222222-2222-4222-8222-222222222222",
          visibility: "groom_private",
        }),
      ],
    })).toBeNull();

    expect(selectCurrentAmoraCoreCriterion({
      expectedOwnerUserId: OWNER,
      expectedVisibility: "bride_private",
      newestFirstRows: [
        criterionRow("우리 둘이 편안한 하루"),
        criterionRow("오래된 기준"),
      ],
    })).toBe("우리 둘이 편안한 하루");
  });

  it("본인이 확인한 기준을 공동 합의가 아닌 현재 private 대화의 판단 렌즈로 설명한다", () => {
    const prompt = getWeddingPlannerSystemPrompt({
      weddingDate: null,
      budget: 0,
      venue: null,
      progress: {},
      brideName: null,
      groomName: null,
      senderName: "민이",
      bookings: [],
      scheduleEvents: [],
      chatSummaries: [],
      coreCriterion: "가족보다 우리 둘 기준을 먼저 확인하기",
    });

    expect(prompt).toContain("내가 직접 확인한 비공개 핵심 기준");
    expect(prompt).toContain("가족보다 우리 둘 기준을 먼저 확인하기");
    expect(prompt).toContain("커플의 공동 합의로 단정하지 마세요");
    expect(prompt).toContain("현재 발화가 다르면 현재 발화를 우선");
  });

  it("개인·공동 기준은 사실 우선순위 뒤의 관련 있는 동률 후보에만 적용한다", () => {
    const prompt = getWeddingPlannerSystemPrompt({
      weddingDate: null,
      budget: 0,
      venue: null,
      progress: {},
      brideName: null,
      groomName: null,
      senderName: "민이",
      bookings: [],
      scheduleEvents: [],
      chatSummaries: [],
      coreCriterion: "우리 둘이 지치지 않는 범위",
      coupleCriterion: "감당 가능한 비용부터 확인하기",
    });

    const groundedOrder =
      "확정된 마감 → 다른 준비를 막는 일 → 승인 대기 → 현재 준비 단계";
    expect(prompt.match(new RegExp(groundedOrder, "gu"))).toHaveLength(2);
    expect(prompt.match(/비슷한 후보가 둘 이상 남을 때만/gu)).toHaveLength(2);
    expect(prompt.match(/현재 요청과 실제 관련이 있을 때만/gu)).toHaveLength(2);
    expect(prompt.match(/기준과 무관한 준비를 억지로 연결하지 마세요/gu)).toHaveLength(2);
  });

  it("전용 기준 영수증은 일반 커플 결정 히스토리에서 제거한다", () => {
    const ordinaryPreference = {
      category: "preference",
      source: "manual",
      metadata: { explicit: true },
    };
    expect(withoutAmoraCoreCriterionReceipts([
      criterionRow("우리 둘이 편안한 하루"),
      ordinaryPreference,
      criterionRow(null, { deleted: true }),
    ])).toEqual([ordinaryPreference]);
  });

  it("현재 두 사람이 각각 확인한 최신 우리 기준만 공동 개인화에 사용한다", () => {
    const confirmed = {
      id: "44444444-4444-4444-8444-444444444444",
      couple_id: COUPLE,
      category: "preference",
      decision_type: "decided",
      chosen_value: { value: "우리 둘이 감당할 수 있는 범위 먼저 보기" },
      source: "manual",
      visibility: "shared",
      source_actor_role: null,
      created_at: "2026-08-14T10:00:00.000Z",
      metadata: {
        criterion_contract: "amora_couple_core_criterion_v1",
        criterion_version: 1,
        bride_user_id: OWNER,
        groom_user_id: PARTNER,
        acceptance_count: 2,
        explicit: true,
      },
    };
    expect(selectCurrentAmoraCoupleCriterion({
      expectedCoupleId: COUPLE,
      expectedBrideUserId: OWNER,
      expectedGroomUserId: PARTNER,
      newestFirstRows: [confirmed],
    })).toBe("우리 둘이 감당할 수 있는 범위 먼저 보기");
    expect(selectCurrentAmoraCoupleCriterionSnapshot({
      expectedCoupleId: COUPLE,
      expectedBrideUserId: OWNER,
      expectedGroomUserId: PARTNER,
      newestFirstRows: [confirmed],
    })).toEqual({
      decisionId: "44444444-4444-4444-8444-444444444444",
      value: "우리 둘이 감당할 수 있는 범위 먼저 보기",
      confirmedAt: "2026-08-14T10:00:00.000Z",
    });
    expect(selectCurrentAmoraCoupleCriterion({
      expectedCoupleId: COUPLE,
      expectedBrideUserId: OWNER,
      expectedGroomUserId: "44444444-4444-4444-8444-444444444444",
      newestFirstRows: [confirmed],
    })).toBeNull();

    const prompt = getWeddingPlannerSystemPrompt({
      weddingDate: null,
      budget: 0,
      venue: null,
      progress: {},
      brideName: null,
      groomName: null,
      senderName: "민지",
      bookings: [],
      scheduleEvents: [],
      chatSummaries: [],
      coupleCriterion: "우리 둘이 감당할 수 있는 범위 먼저 보기",
    });
    expect(prompt).toContain("두 사람이 각각 확인한 우리 기준");
    expect(prompt).toContain("우리 둘이 감당할 수 있는 범위 먼저 보기");
    expect(withoutAmoraCoreCriterionReceipts([confirmed])).toEqual([]);
  });

  it("채팅 정본 조회가 우리 기준의 결정 ID와 정확한 커플·행위자 필드를 함께 읽는다", () => {
    const routeSource = readFileSync(
      resolve(process.cwd(), "src/app/api/chat/route.ts"),
      "utf8",
    );
    expect(routeSource).toContain(
      '.select("id, couple_id, category, decision_type, title, chosen_value, reasoning, confidence, stage_tag, source, visibility, source_actor_role, created_at, memory_key, superseded_at, metadata")',
    );
  });
});
