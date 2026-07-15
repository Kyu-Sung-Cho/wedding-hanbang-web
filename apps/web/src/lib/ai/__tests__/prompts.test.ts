import { describe, expect, it } from "vitest";
import { getWeddingPlannerSystemPrompt } from "../prompts";
import { AMORA_DEMO_SUGGESTIONS, AMORA_DEMO_WELCOME } from "../../chat/amoraDemoCopy";

const baseContext = {
  weddingDate: null,
  budget: 0,
  venue: null,
  progress: {},
  brideName: null,
  groomName: null,
  senderName: "민이",
  scheduleEvents: [],
  chatSummaries: [],
};

describe("getWeddingPlannerSystemPrompt", () => {
  it("puts the caring voice contract ahead of operational rules", () => {
    const prompt = getWeddingPlannerSystemPrompt({ ...baseContext, bookings: [] });

    const voiceIndex = prompt.indexOf("최우선 대화 원칙 — 친언니처럼 다정하고 끝까지 챙기는 아모라");
    const dateRuleIndex = prompt.indexOf("날짜 처리 절대 규칙");

    expect(voiceIndex).toBeGreaterThan(-1);
    expect(dateRuleIndex).toBeGreaterThan(voiceIndex);
    expect(prompt).toContain("사람인 척하거나 실제 결혼·상담 경험을 지어내지 마세요");
    expect(prompt).toContain("반영되지 않았다는 사실");
  });

  it("does not force a robotic three-suggestion ending on every reply", () => {
    const prompt = getWeddingPlannerSystemPrompt({ ...baseContext, bookings: [] });

    expect(prompt).toContain("이어서 할 수 있는 것 (선택)");
    expect(prompt).toContain("모든 답변에 붙이지 마세요");
    expect(prompt).not.toContain("## 후속 질문 (필수)");
    expect(prompt).not.toContain("수백 커플의 결혼을 도운");
  });

  it("keeps the warmer demo greeting honest about non-persistence", () => {
    expect(AMORA_DEMO_WELCOME).toContain("실제 일정·예산에 저장되지는 않지만");
    expect(AMORA_DEMO_WELCOME).toContain("제가 같이 챙겨볼게요");
    expect(AMORA_DEMO_SUGGESTIONS).toHaveLength(3);
    expect(new Set(AMORA_DEMO_SUGGESTIONS).size).toBe(AMORA_DEMO_SUGGESTIONS.length);
  });

  it("never injects raw chat feedback into the system prompt", () => {
    const crossCoupleCanary = "CROSS_COUPLE_PRIVATE_CANARY_7f30d1";
    const contextWithUntrustedLegacyFeedback = {
      ...baseContext,
      bookings: [],
      feedbackLessons: [crossCoupleCanary],
    };
    const prompt = getWeddingPlannerSystemPrompt(contextWithUntrustedLegacyFeedback);

    expect(prompt).not.toContain(crossCoupleCanary);
  });

  it("includes actual booking cost and extra cost when outcome data exists", () => {
    const prompt = getWeddingPlannerSystemPrompt({
      ...baseContext,
      bookings: [
        {
          vendorName: "한방웨딩홀",
          category: "venue",
          date: "2026-11-28",
          time: "13:00",
          status: "completed",
          amount: 2_500_000,
          contractedAmount: 2_500_000,
          actualAmount: 3_000_000,
        },
      ],
    });

    expect(prompt).toContain("한방웨딩홀");
    expect(prompt).toContain("✅완료");
    expect(prompt).toContain("실결제: 300만원");
    expect(prompt).toContain("계약/견적: 250만원");
    expect(prompt).toContain("추가금: 50만원");
  });

  it("keeps the original booking amount when no actual cost is recorded", () => {
    const prompt = getWeddingPlannerSystemPrompt({
      ...baseContext,
      bookings: [
        {
          vendorName: "한방스튜디오",
          category: "studio",
          date: "2026-08-10",
          time: "11:00",
          status: "confirmed",
          amount: 500_000,
        },
      ],
    });

    expect(prompt).toContain("한방스튜디오");
    expect(prompt).toContain("✅확정");
    expect(prompt).toContain("예약금액: 50만원");
  });
});

// 컴플라이언스 회귀 잠금 (3.3 감사 I2 해소) — 전략·법적 결정(6/12)이 인코딩된
// 프롬프트 지시가 리팩토링에서 조용히 사라지는 것을 차단한다. 문구를 바꿀 땐
// 의도적으로 이 테스트도 함께 바꿔야 한다.
describe("시스템 프롬프트 컴플라이언스 잠금", () => {
  const prompt = getWeddingPlannerSystemPrompt({ ...baseContext, bookings: [] });

  it("견적 판정 금지 지시가 존재한다 (판정 금지 제품 원칙)", () => {
    expect(prompt).toContain("견적의 좋고 나쁨을 판정하지 마세요");
  });

  it("업체 상대 권고·단정 금지 지시가 존재한다 (6/12 법적 수정)", () => {
    expect(prompt).toContain("업체 상대 권고·단정 금지");
  });

  it("근거 등급 A~F 원칙이 존재한다 (할루시네이션 방지)", () => {
    expect(prompt).toContain("근거 등급 원칙");
    expect(prompt).toContain("F: 근거 없음");
  });

  it("환각 업체 금지 + 0건 정직 안내가 존재한다", () => {
    expect(prompt).toContain("절대 가짜 업체 만들지 마세요");
  });

  it("갈등 중재 편들기 금지가 존재한다", () => {
    expect(prompt).toContain("절대 한쪽에게 도덕적 공을 몰아주지 마세요");
  });

  it("출처 예시가 컨텍스트 값 사용을 강제한다 (낡은 예시 수치 복사 방지 — 2026-07-06)", () => {
    expect(prompt).toContain("예시 문장의 수치를 복사 금지");
    expect(prompt).not.toContain("5500만원");
    expect(prompt).not.toContain("2025년 4월 기준");
  });

  it("시세 컨텍스트가 최신 기간 라벨로 자기 표기된다", () => {
    expect(prompt).toMatch(/한국소비자원 웨딩 시세 \(20\d{2}년 \d{1,2}월 기준/);
  });

  it("법률·의료 조언 금지가 존재한다", () => {
    expect(prompt).toContain("법적/의료적 조언");
  });

  it("콜드스타트 첫 세션 스크립트가 존재한다 (첫 3문답 가치 증명 — 2026-07-06)", () => {
    expect(prompt).toContain("첫 3문답 안에 가치 증명");
    expect(prompt).toContain("계약 전 체크");
  });
});
