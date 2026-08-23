import { describe, expect, it } from "vitest";

import {
  assessSelfReportedConflictOffer,
  shouldOfferMediation,
} from "@/lib/chat/mediationOffer";

/**
 * 중재로 가는 문이 사실상 닫혀 있었다.
 *
 * 자동 배너는 **두 사람이 서로에게 직접** 보낸 메시지에서 양쪽 다 갈등 신호를
 * 냈을 때만 뜬다. 커플이 앱 안에서 '파트너에게 보내기' 토글을 켜고 서로 싸워야
 * 열린다는 뜻이다. 라이브에서 중재 카드가 한 번도 뜨지 않은 1차 원인이다
 * (2026-08-24 감사).
 *
 * 자동 배너의 조건 자체는 건드리지 않는다 — 한 사람 하소연에 중재를 들이미는
 * 것은 실례고, 상대의 마음을 넘겨짚는 문구가 된다.
 *
 * 대신 혼자 이야기한 경우에도 **문을 보여준다.** 시작하지는 않는다.
 */

const partnerMsg = (role: "bride" | "groom", content: string) => ({
  visibility: "shared" as const,
  metadata: { target: "partner" },
  sender_role: role,
  content,
});

const amoraMsg = (role: "bride" | "groom", content: string) => ({
  visibility: "shared" as const,
  metadata: { target: "ai" },
  sender_role: role,
  content,
});

const 갈등1 = "예산 때문에 계속 싸워요 너무 지쳐요";
const 갈등2 = "말을 꺼내면 화만 내서 대화가 안 돼요";

describe("혼자 이야기해도 중재 문이 보인다", () => {
  it("아모라에게만 갈등을 이야기해도 제안이 뜬다", () => {
    const messages = [amoraMsg("groom", 갈등1), amoraMsg("groom", 갈등2)];
    // 기존 자동 배너는 여전히 안 뜬다 — 그 조건은 그대로다.
    expect(shouldOfferMediation(messages as never)).toBe(false);
    // 새 경로가 문을 보여준다.
    expect(
      assessSelfReportedConflictOffer(messages as never, "groom").shouldOffer,
    ).toBe(true);
  });

  it("상대가 쓴 말은 내 근거로 세지 않는다", () => {
    const messages = [amoraMsg("bride", 갈등1), amoraMsg("bride", 갈등2)];
    expect(
      assessSelfReportedConflictOffer(messages as never, "groom").shouldOffer,
    ).toBe(false);
  });

  it("한 마디로는 묻지 않는다", () => {
    const messages = [amoraMsg("groom", 갈등1)];
    const result = assessSelfReportedConflictOffer(messages as never, "groom");
    expect(result.shouldOffer).toBe(false);
    expect(result.evidenceCount).toBe(1);
  });

  it("평범한 준비 이야기에는 뜨지 않는다", () => {
    const messages = [
      amoraMsg("groom", "예식장 계약 조건 좀 봐줘"),
      amoraMsg("groom", "드레스 예산 300만원으로 잡아줘"),
      amoraMsg("groom", "상견례 식당 추천해줘"),
    ];
    expect(
      assessSelfReportedConflictOffer(messages as never, "groom").shouldOffer,
    ).toBe(false);
  });

  it("두 사람이 서로 싸운 경우는 기존 배너가 그대로 맡는다", () => {
    const messages = [
      partnerMsg("groom", 갈등1),
      partnerMsg("bride", 갈등2),
      partnerMsg("groom", 갈등2),
    ];
    expect(shouldOfferMediation(messages as never)).toBe(true);
  });

  it("역할을 모르면 묻지 않는다", () => {
    const messages = [amoraMsg("groom", 갈등1), amoraMsg("groom", 갈등2)];
    expect(
      assessSelfReportedConflictOffer(messages as never, null).shouldOffer,
    ).toBe(false);
  });
});
