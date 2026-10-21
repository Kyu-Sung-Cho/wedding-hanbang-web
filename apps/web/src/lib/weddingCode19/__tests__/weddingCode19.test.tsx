// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ALL_QUESTIONS_19,
  CHARACTER_PROFILES_19,
  COUPLE_AXIS_SYNERGY_19,
  ITEM_INTERPRETATIONS_19,
  type WeddingCode19Answers,
  type WeddingCode19Code,
} from "../data";
import {
  buildCoupleComparison19,
  buildPersonalReport19,
  createVirtualPartnerAnswers19,
  decodePartnerPayload19,
  encodePartnerPayload19,
  scoreWeddingCode19,
  shouldTriggerCeilingModal19,
} from "../engine";
import WeddingCode19Client from "@/components/weddingCode19/WeddingCode19Client";

vi.mock("next/link", () => ({
  default: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props} />
  ),
}));

describe("웨딩코드 19문항 마스터 데이터 & 투트랙 채점 엔진 검증", () => {
  it("19개 문항, 16종 동물 캐릭터, 19개 문항별 해석·솔루션, 12종 축 시너지 데이터가 모두 존재한다", () => {
    expect(ALL_QUESTIONS_19).toHaveLength(19);
    expect(Object.keys(CHARACTER_PROFILES_19)).toHaveLength(16);
    expect(Object.keys(ITEM_INTERPRETATIONS_19)).toHaveLength(19);
    expect(Object.keys(COUPLE_AXIS_SYNERGY_19)).toHaveLength(12);
  });

  it("완전 중립(모두 3 / C / D / UNKNOWN / NA) 응답 시 기본값 IPEH를 반환한다", () => {
    const neutral: WeddingCode19Answers = {
      Q1: 3,
      Q2: 3,
      Q3: 3,
      Q4: "UNKNOWN",
      Q5: "NA",
      Q6: 3,
      Q7: 3,
      Q8: 3,
      Q9: 3,
      Q10: "NA",
      Q11: 3,
      Q12: "UNKNOWN",
      Q13: "C",
      Q14: "D",
      Q15: "E",
      Q16: "F",
      Q17: "C",
      Q18: "D",
      Q19: "C",
    };
    const scored = scoreWeddingCode19(neutral);
    expect(scored.code).toBe("IPEH");
    const report = buildPersonalReport19(neutral);
    // NA와 F를 선택한 Q5, Q10, Q16은 결과 리포트에서 완전히 숨김 처리된다
    expect(report.basket.hiddenQuestionIds).toEqual(["Q5", "Q10", "Q16"]);
    expect(
      report.workstyleSections
        .flatMap((s) => s.items)
        .map((i) => i.questionId),
    ).not.toContain("Q16");
  });

  it("축 1~4 동점 시 명세된 우선순위 규칙(Q2→Q1→I, Q13→P, Q14→Q11→E, Q15(3) vs Q19(2)→H)을 정확히 따른다", () => {
    // 축 1 동점: Q1=5(+2 S), Q2=4(+1 I), Q4=4(+1 I) -> 2 S vs 2 I 동점 -> Q2 방향(I) 우선!
    expect(scoreWeddingCode19({ Q1: 5, Q2: 4, Q4: 4 }).axes.axis1.winner).toBe("I");
    // 축 1 동점 & Q2 중립: Q1=4(+1 S), Q2=3(0), Q4=4(+1 I) -> 1 S vs 1 I 동점 -> Q2 중립이므로 Q1 방향(S) 우선!
    expect(scoreWeddingCode19({ Q1: 4, Q2: 3, Q4: 4 }).axes.axis1.winner).toBe("S");

    // 축 2 동점: Q13=A(+4 D), Q5=1(+2 P), Q8=1(+2 P), Q9=3(0) -> 4 D vs 4 P 동점 -> Q13 방향(D) 우선!
    expect(
      scoreWeddingCode19({ Q13: "A", Q5: 1, Q8: 1, Q9: 3 }).axes.axis2.winner,
    ).toBe("D");

    // 축 3 동점: Q14=A(+2 M), Q11=1(+2 E), Q12=3(0) -> 2 M vs 2 E 동점 -> Q14 방향(M) 우선!
    expect(
      scoreWeddingCode19({ Q14: "A", Q11: 1, Q12: 3 }).axes.axis3.winner,
    ).toBe("M");
    // 축 3 동점 & Q14 중립: Q14=C(0), Q11=4(+1 M), Q12=2(+1 E) -> 1 M vs 1 E 동점 -> Q11 방향(M) 우선!
    expect(
      scoreWeddingCode19({ Q14: "C", Q11: 4, Q12: 2 }).axes.axis3.winner,
    ).toBe("M");

    // 축 4 가중치 차등: Q15=A(+3 H), Q19=B(+2 R) -> H 승리 / Q15=B(+3 R), Q19=A(+2 H) -> R 승리
    expect(scoreWeddingCode19({ Q15: "A", Q19: "B" }).axes.axis4.winner).toBe("H");
    expect(scoreWeddingCode19({ Q15: "B", Q19: "A" }).axes.axis4.winner).toBe("R");
  });

  it("16가지 가상 파트너 프리셋이 각각 정확한 4자리 캐릭터 코드로 산출된다", () => {
    const codes = Object.keys(CHARACTER_PROFILES_19) as WeddingCode19Code[];
    for (const code of codes) {
      const preset = createVirtualPartnerAnswers19(code);
      expect(scoreWeddingCode19(preset.answers).code).toBe(code);
    }
  });

  it("천장 효과 방지 모달 발동 조건(Q5~Q10 중 5가 4개 이상)을 정확히 판정한다", () => {
    expect(
      shouldTriggerCeilingModal19({ Q5: 5, Q6: 5, Q7: 5, Q8: 4, Q9: 4, Q10: 4 }),
    ).toBe(false);
    expect(
      shouldTriggerCeilingModal19({ Q5: 5, Q6: 5, Q7: 5, Q8: 5, Q9: 2, Q10: 2 }),
    ).toBe(true);
  });

  it("URL ?partner= 인코딩/디코딩과 커플 비교 리포트(일치·양보·충돌 1:1 솔루션)가 정확히 동작한다", () => {
    const myPreset = createVirtualPartnerAnswers19("SDMH");
    const partnerPreset = createVirtualPartnerAnswers19("IPER");
    // Q6는 myPreset에서 3(양보), partnerPreset에서 5(확고한 선호) -> 양보 매칭!
    const encoded = encodePartnerPayload19(
      partnerPreset.answers,
      partnerPreset.topPriorityIds,
    );
    const decoded = decodePartnerPayload19(encoded);
    expect(decoded).not.toBeNull();
    expect(decoded?.answers).toEqual(partnerPreset.answers);

    const comparison = buildCoupleComparison19(
      myPreset.answers,
      decoded!.answers,
      myPreset.topPriorityIds,
      decoded!.topPriorityIds,
    );
    expect(comparison.myReport.code).toBe("SDMH");
    expect(comparison.partnerReport.code).toBe("IPER");
    expect(comparison.axisSynergies.map((s) => s.pairLabel)).toEqual([
      "S + I",
      "D + P",
      "M + E",
      "H + R",
    ]);
    // Q6는 양보 매칭에 포함되어야 한다
    expect(
      comparison.concessionMatches.some((m) => m.questionId === "Q6"),
    ).toBe(true);
    // Q1, Q2, Q13, Q17, Q18 등은 반대 방향이므로 충돌 솔루션에 포함되어야 한다
    expect(
      comparison.conflictItems.some((c) => c.questionId === "Q13"),
    ).toBe(true);
    expect(comparison.crisisWarnings).toHaveLength(2);
    expect(comparison.empathyBridge.translations.length).toBeGreaterThanOrEqual(2);
  });

  it("파트1 문항과 파트2 응답에 따라 명세된 Track A 점수(동점 시 Q13·Q14 우선)와 차순위 절약 추천·심층 심리 통역이 정확히 생성된다", () => {
    const sampleAnswers: WeddingCode19Answers = {
      Q1: 4,
      Q2: 4,
      Q3: 4,
      Q4: 4,
      Q5: 5,
      Q6: 5,
      Q7: 5,
      Q8: 4,
      Q9: 4,
      Q10: 4,
      Q11: 4,
      Q12: 4,
      Q13: "B",
      Q14: "B",
      Q15: "B",
      Q16: "B",
      Q17: "B",
      Q18: "B",
      Q19: "B",
    };
    const report = buildPersonalReport19(sampleAnswers, ["Q6", "Q7"]);
    // Q13=B(+4 P) vs Q5=5(+2 D), Q8=4(+1 D), Q9=4(+1 D) -> 4 D : 4 P 동점 -> Q13 방향(P) 승리!
    expect(report.axes.axis2.winner).toBe("P");
    // Q14=B(+3 E) vs Q11=4(+1 M), Q12=4(+1 M) -> 2 M : 3 E -> Q14 방향(E) 승리!
    expect(report.axes.axis3.winner).toBe("E");
    expect(report.basket.saveSimplify12).toHaveLength(0);
    expect(report.basket.relativeSaveSuggestions.length).toBeGreaterThan(0);
    expect(report.hiddenPsychology.unconsciousTitle.length).toBeGreaterThan(5);
    expect(report.hiddenPsychology.partnerTranslations).toHaveLength(2);
  });

  it("16종 캐릭터 이모지가 중복 없이 고유하며, Q14=B 역전 방어 및 커플 비교 무손실 분류(A/B vs C, 미정 빈칸 리드, 1순위 온도차)가 작동한다", () => {
    const emojis = Object.values(CHARACTER_PROFILES_19).map((c) => c.emoji);
    expect(new Set(emojis).size).toBe(16);

    // Q11=5, Q12=4(+3 M)이더라도 Q14=B(+3 E, 동점 시 Q14 우선)를 고르면 E로 판정되고 입체 배지가 생성된다
    const smartEasy = scoreWeddingCode19({ Q11: 5, Q12: 4, Q14: "B" });
    expect(smartEasy.axes.axis3.winner).toBe("E");
    expect(smartEasy.axes.axis3.nuanceBadge).toContain("스마트 선별형");

    // Q13=B(+4 P)이고 Q6=5(하객 교통 최우선)인 경우 Q5=5, Q8=5, Q9=4(+5 D)여도 실속(P)이 역전되지 않는다
    const guestPractical = scoreWeddingCode19({
      Q5: 5,
      Q6: 5,
      Q8: 5,
      Q9: 4,
      Q13: "B",
    });
    expect(guestPractical.axes.axis2.winner).toBe("P");

    // 커플 비교 시 A vs C(절충 온도차), 확고 vs UNKNOWN/E(미정 빈칸 리드), 둘 다 3/D(양보 합의), 1순위 5 vs 4(예산 반대 시)가 단 하나도 증발하지 않는다
    const myAns: WeddingCode19Answers = {
      Q1: 5,
      Q2: 3,
      Q3: 4,
      Q4: "UNKNOWN",
      Q5: 5,
      Q6: 4,
      Q7: 5,
      Q8: 5,
      Q9: 5,
      Q10: "NA",
      Q11: 4,
      Q12: 3,
      Q13: "A",
      Q14: "C",
      Q15: "A",
      Q16: "D",
      Q17: "A",
      Q18: "C",
      Q19: "E",
    };
    const partnerAns: WeddingCode19Answers = {
      Q1: 4,
      Q2: 3,
      Q3: "UNKNOWN",
      Q4: "UNKNOWN",
      Q5: 4,
      Q6: 4,
      Q7: 2,
      Q8: 4,
      Q9: 4,
      Q10: 4,
      Q11: 4,
      Q12: 3,
      Q13: "B",
      Q14: "A",
      Q15: "C",
      Q16: "D",
      Q17: "C",
      Q18: "A",
      Q19: "B",
    };
    const cmp = buildCoupleComparison19(myAns, partnerAns, ["Q5", "Q7"], []);
    // Q5는 둘 다 긍정(5 vs 4)이지만 나의 타협 불가 1순위이고 Q13 예산(A vs B)이 반대이므로 priority_gap 조율에도 포함
    expect(
      cmp.conflictItems.some(
        (c) => c.questionId === "Q5" && c.conflictType === "priority_gap",
      ),
    ).toBe(true);
    // Q14(C vs A), Q15(A vs C), Q17(A vs C), Q18(C vs A)는 balance_gap 조율에 포함
    expect(
      cmp.conflictItems.some(
        (c) => c.questionId === "Q15" && c.conflictType === "balance_gap",
      ),
    ).toBe(true);
    // Q3(4 vs UNKNOWN), Q19(E vs B)는 lead_undecided 찬스 카드에 포함
    expect(
      cmp.concessionMatches.some(
        (m) => m.questionId === "Q3" && m.matchType === "lead_undecided",
      ),
    ).toBe(true);
    expect(
      cmp.concessionMatches.some(
        (m) => m.questionId === "Q19" && m.matchType === "lead_undecided",
      ),
    ).toBe(true);
    // Q2(3 vs 3), Q4(UNKNOWN vs UNKNOWN), Q16(D vs D)는 alignedItems로 가이드 제공
    expect(cmp.alignedItems.some((a) => a.questionId === "Q2")).toBe(true);
    expect(cmp.alignedItems.some((a) => a.questionId === "Q16")).toBe(true);
  });
});

describe("WeddingCode19Client 전체 인터랙션 흐름 검증", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    window.sessionStorage.clear();
    window.localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    window.history.replaceState(null, "", "/wedding-code");
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
      root = null;
    }
    container.remove();
  });

  it("파트너 링크 진입 배너 표시 → 파트1(Q1~Q12) → 브릿지 화면 → 파트2(Q13~Q19) → 천장 효과 모달 → 개인/커플 리포트까지 완주한다", async () => {
    const partnerPreset = createVirtualPartnerAnswers19("IPER");
    const encoded = encodePartnerPayload19(
      partnerPreset.answers,
      partnerPreset.topPriorityIds,
    );
    window.history.replaceState(
      null,
      "",
      `/wedding-code?partner=${encodeURIComponent(encoded)}`,
    );

    await act(async () => {
      root = createRoot(container);
      root.render(<WeddingCode19Client />);
    });

    // 1. 시작 화면 + 파트너 링크 배너 확인
    expect(
      container.querySelector('[data-testid="wc19-partner-banner"]')?.textContent,
    ).toContain("파트너가 보낸 웨딩코드가 도착했어요!");
    expect(
      container.querySelector('[data-testid="wc19-screen-intro"]')?.textContent,
    ).toContain("총 19문항이며 약 3분이면 충분합니다.");

    // 시작 버튼 클릭
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="wc19-start-button"]')
        ?.click();
    });

    // 2. 파트 1 (Q1 ~ Q12): Q5~Q8 4개에 5점을 주어 천장 효과 모달 조건 충족, Q10은 NA 선택
    for (let i = 1; i <= 12; i++) {
      expect(
        container.querySelector('[data-testid="wc19-progress-text"]')?.textContent,
      ).toBe(`${i} / 19`);
      const targetOption =
        i === 10
          ? "wc19-option-NA"
          : i >= 5 && i <= 8
            ? "wc19-option-5"
            : "wc19-option-4";
      await act(async () => {
        container
          .querySelector<HTMLButtonElement>(`[data-testid="${targetOption}"]`)
          ?.click();
      });
    }

    // 3. 12번 응답 직후 브릿지 화면 확인
    expect(
      container.querySelector('[data-testid="wc19-screen-bridge"]')?.textContent,
    ).toContain("절반 이상 왔어요! (12/19 완료)");

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="wc19-bridge-continue"]')
        ?.click();
    });

    // 4. 파트 2 (Q13 ~ Q19)
    for (let i = 13; i <= 19; i++) {
      expect(
        container.querySelector('[data-testid="wc19-progress-text"]')?.textContent,
      ).toBe(`${i} / 19`);
      await act(async () => {
        container
          .querySelector<HTMLButtonElement>('[data-testid="wc19-option-A"]')
          ?.click();
      });
    }

    // 5. 천장 효과 방지 모달 노출 확인 (Q5~Q8 4개가 ⑤이므로)
    const modal = container.querySelector('[data-testid="wc19-ceiling-modal"]');
    expect(modal).not.toBeNull();
    expect(modal?.textContent).toContain(
      "방금 ‘꼭 챙기고 싶다(⑤)’고 고르신 항목이 많아요!",
    );

    // Q5, Q7 2개 선택 후 확정
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="wc19-ceiling-pick-Q5"]')
        ?.click();
      container
        .querySelector<HTMLButtonElement>('[data-testid="wc19-ceiling-pick-Q7"]')
        ?.click();
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="wc19-ceiling-confirm"]')
        ?.click();
    });

    // 6. 파트너 링크로 진입했으므로 커플 비교 탭이 바로 열리고, 개인 탭으로 전환 시 타협 불가 1순위 배지 및 NA 숨김 확인
    expect(
      container.querySelector('[data-testid="wc19-couple-comparison-content"]'),
    ).not.toBeNull();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="wc19-tab-personal"]')
        ?.click();
    });

    const personalText =
      container.querySelector('[data-testid="wc19-personal-report"]')
        ?.textContent ?? "";
    expect(personalText).toContain("[타협 불가 1순위 배지]");
    // NA로 응답한 Q10(전통 예절·양가 인사 격식)은 개인 리포트에서 완전히 숨겨진다
    expect(personalText).not.toContain("전통 예절·양가 인사 격식");

    // 7. 아모라 AI 맞춤 결혼 준비 시작 CTA 버튼 및 프리필 미리보기 확인
    const amoraCta = container.querySelector<HTMLAnchorElement>(
      '[data-testid="wc19-start-amora-cta"]',
    );
    expect(amoraCta).not.toBeNull();
    expect(amoraCta?.getAttribute("href")).toContain("/wedding/chat?prefill=");
    expect(
      container.querySelector('[data-testid="wc19-amora-prefill-preview"]')
        ?.textContent,
    ).toContain("우리만의 정원을 가꾸는 사슴");
  });
});
