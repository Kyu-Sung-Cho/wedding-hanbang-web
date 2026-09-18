import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { applyAmoraOutputHygiene } from "@/lib/ai/amoraOutputHygiene";
import { extractAmoraPendingAction, isAmoraFailedProposalNotice } from "@/lib/ai/amoraPendingAction";
import { hasNewAmoraChangeIntent } from "@/lib/ai/amoraPendingActionContinuity";
import { composeAmoraPersistenceTerminal } from "@/lib/ai/amoraPersistenceClaims";
import { classifyAmoraQuestionScope } from "@/lib/ai/amoraQuestionScope";
import {
  AMORA_TYPED_CARD_ACCEPTANCE_REPLY,
  classifyAmoraTypedCardAcceptance,
  isAmoraTypedCardAcceptance,
  isAmoraTypedCardAcceptanceReply,
} from "@/lib/ai/amoraTypedCardAcceptance";
import { AMORA_CHANGE_REVIEW_COPY } from "@hanbang/shared";

/**
 * 2026-09-15 운영 재현: 카드가 뜬 뒤 "응 적용해줘" 라고 치면 옛 카드는 잠기고
 * 아모라는 누를 수 없는 버튼을 누르라고 했다. 승낙만 알아보고, 고치거나 미루는 말은
 * 승낙으로 보지 않는다.
 */
describe("카드에 말로 한 승낙", () => {
  const ACCEPTANCES = [
    "응",
    "응 적용해줘",
    "응응 좋아",
    "네",
    "네!",
    "네 그렇게 적용해줘",
    "좋아",
    "좋아요, 그렇게 해 주세요",
    "좋아 그걸로 하자",
    "그래",
    "그래 그렇게 해",
    "그렇게 해줘",
    "적용해줘",
    "반영해 주세요.",
    "이대로 적용해줘",
    "기존 제안대로 반영해 주세요.",
    "오케이 진행해줘",
    "ㅇㅇ 적용해줘",
    "네 부탁해요~",
    "알겠어 저장해줘",
  ];

  it.each(ACCEPTANCES)("승낙으로 본다: %s", (text) => {
    expect(isAmoraTypedCardAcceptance(text)).toBe(true);
  });

  it.each(ACCEPTANCES.filter((text) => text !== "ㅇㅇ 적용해줘"))("새 변경 요청 판정과도 어긋나지 않는다: %s", (text) => {
    expect(hasNewAmoraChangeIntent(text)).toBe(false);
  });

  it("새 변경 요청 판정이 놓치는 승낙은 라우트가 승낙 판정으로 대기 카드를 살린다", () => {
    // `hasNewAmoraChangeIntent` 의 승낙 머리말에는 "ㅇㅇ" 이 없어 "적용해줘" 가 새 변경으로
    // 읽힌다. 라우트는 `!hasNewAmoraChangeIntent(...) || isAmoraTypedCardAcceptance(...)` 로
    // 대기 카드를 읽는다 — 라우트 통합 검사(routeOpenAIContract)가 실제 이월을 본다.
    expect(hasNewAmoraChangeIntent("ㅇㅇ 적용해줘")).toBe(true);
    expect(isAmoraTypedCardAcceptance("ㅇㅇ 적용해줘")).toBe(true);
  });

  it.each(ACCEPTANCES)("안전·위로 범위로 판정되지 않는다: %s", (text) => {
    const { scope } = classifyAmoraQuestionScope({ userText: text });
    expect(["W0_wedding_core", "W1_wedding_adjacent", "W4_out_of_scope"]).toContain(scope);
  });

  it.each([
    // 수정 — 새 지시다.
    "응 근데 한복은 100으로",
    "응 500으로 해줘",
    "좋아 근데 날짜는 다음 주로",
    "네 드레스 예산도 적용해줘",
    "이대로 적용해줘 그리고 일정도 추가해줘",
    "그렇게 하되 식대는 빼고",
    // 부정·보류
    "아니",
    "아니 적용하지 마",
    "응 잠깐만",
    "잠깐 적용해줘",
    "그거 말고",
    "취소해줘",
    "적용 안 해",
    "나중에 할게",
    "다시 보여줘",
    // 질문·되짚기
    "응?",
    "적용해줘?",
    "그대로",
    "왜 이 금액이야",
    "",
  ])("승낙으로 보지 않는다: %s", (text) => {
    expect(isAmoraTypedCardAcceptance(text)).toBe(false);
  });

  // 리뷰 [5]: NFKC 가 "ㅇㅋ" 를 "ᄋᄏ" 로 바꾸고, 웃음 꼬리 제거가 끝의 ᄏ 을 먼저 지워
  // "ᄋ" 만 남았다. 흔한 승낙 표기 하나가 다시 옛 카드 잠김 경로를 탔다.
  it.each(["ㅇㅋ", "ㅇㅋㅋ", "ㅇㅋ!", "ㅇㅋ 적용해줘", "ㅇㅋㅋ 적용해줘", "좋아ㅋㅋ", "응ㅎㅎ"])("자모 승낙 표기도 승낙으로 본다: %s", (text) => {
    expect(isAmoraTypedCardAcceptance(text)).toBe(true);
  });

  it.each(["ㅇㅋ?", "ㅇㅋ 근데 식대는 빼고", "ㅋㅋ", "ㅎㅎ", "ㅋㅋㅋ 적용", "ㅇ", "ㅋ"])("자모 표기라도 승낙이 아닌 말은 거짓이다: %s", (text) => {
    expect(isAmoraTypedCardAcceptance(text)).toBe(false);
  });

  // 리뷰 [3]: 승낙어만 있는 말은 직전 답변의 새 질문에 대한 답일 수 있다. 라우트가 직전 행을
  // 보고 가를 수 있게 무엇으로 승낙이 됐는지 나눠 돌려준다.
  it.each([
    ["응", "bare"],
    ["네!", "bare"],
    ["좋아요", "bare"],
    ["ㅇㅋ", "bare"],
    ["응응 좋아", "bare"],
    ["응 해줘", "bare"],
    ["네 부탁해요~", "bare"],
    ["응 적용해줘", "explicit"],
    ["반영해 주세요.", "explicit"],
    ["이대로 적용해줘", "explicit"],
    ["그렇게 해줘", "explicit"],
    ["좋아 그걸로 하자", "explicit"],
    ["기존 제안대로 반영해 주세요.", "explicit"],
    ["ㅇㅋ 적용해줘", "explicit"],
    ["오케이 진행해줘", "explicit"],
  ] as const)("승낙의 강도를 가른다: %s → %s", (text, strength) => {
    expect(classifyAmoraTypedCardAcceptance(text)).toBe(strength);
  });

  it.each(["응?", "그대로", "아니", "응 근데 한복은 100으로", "", undefined])("승낙이 아니면 강도도 없다: %s", (text) => {
    expect(classifyAmoraTypedCardAcceptance(text)).toBeNull();
  });

  it("문자열이 아니면 거짓이다", () => {
    expect(isAmoraTypedCardAcceptance(undefined)).toBe(false);
    expect(isAmoraTypedCardAcceptance(null)).toBe(false);
    expect(isAmoraTypedCardAcceptance(1)).toBe(false);
  });

  it("긴 문장은 승낙어로 시작해도 승낙이 아니다", () => {
    expect(isAmoraTypedCardAcceptance("네 네 네 네 네 네 네 네 네 네 네 네 네 네 네 네 네 네 적용해줘")).toBe(false);
  });
});

describe("말로 승낙한 턴의 서버 안내", () => {
  it("화면이 실제로 쓰는 버튼 이름을 웹·앱 모두 맞게 부른다", () => {
    const webCard = readFileSync(
      join(process.cwd(), "src", "components", "app", "chat", "PendingAmoraActionCard.tsx"),
      "utf8",
    );
    const mobileChat = readFileSync(
      join(process.cwd(), "..", "mobile", "app", "(tabs)", "chat.tsx"),
      "utf8",
    );
    // 웹: 카드의 첫 버튼 → 확인 창의 적용 버튼
    expect(webCard).toContain(': "내용 확인하기"}');
    expect(webCard).toMatch(/:\s*"이대로 적용";/);
    // 앱(2026-09-18부터 웹과 같은 두 단계): 카드의 첫 버튼은 shared 의 「내용 확인하기」이고,
    // 「이대로 적용」은 확인 창으로 넘기는 적용 버튼 이름이다.
    expect(mobileChat).toContain("AMORA_CHANGE_REVIEW_COPY.openLabel");
    expect(AMORA_CHANGE_REVIEW_COPY.openLabel).toBe("내용 확인하기");
    expect(mobileChat).toMatch(/:\s*"이대로 적용";/);
    expect(mobileChat).toContain("applyLabel={applyLabel}");

    expect(AMORA_TYPED_CARD_ACCEPTANCE_REPLY).toContain("아래 카드의 ‘내용 확인하기’를 누른 뒤 ‘이대로 적용’");
    // 한쪽 화면에만 있는 버튼을 가리키지 않는다.
    expect(AMORA_TYPED_CARD_ACCEPTANCE_REPLY).not.toContain("앱에서는");
    expect(AMORA_TYPED_CARD_ACCEPTANCE_REPLY).toContain("아직 반영하지 않았어요");
  });

  it("문장이 바뀌기 전에 저장된 같은 안내도 서버 고정 안내로 알아본다", () => {
    expect(isAmoraTypedCardAcceptanceReply(AMORA_TYPED_CARD_ACCEPTANCE_REPLY)).toBe(true);
    expect(isAmoraTypedCardAcceptanceReply(
      "아직 반영하지 않았어요. 웹에서는 아래 카드의 ‘내용 확인하기’를 누른 뒤 ‘이대로 적용’을, 앱에서는 카드의 ‘이대로 적용’을 누르면 반영돼요.",
    )).toBe(true);
    for (const other of ["아직 반영하지 않았어요.", "응 적용해줘", null, undefined, 3]) {
      expect(isAmoraTypedCardAcceptanceReply(other)).toBe(false);
    }
    const route = readFileSync(join(process.cwd(), "src", "app", "api", "chat", "route.ts"), "utf8");
    expect(route).toContain("|| isAmoraTypedCardAcceptanceReply(previousCanonicalRow?.content);");
  });

  it("제품 금지 표현을 쓰지 않는다", () => {
    expect(AMORA_TYPED_CARD_ACCEPTANCE_REPLY).not.toMatch(/플래너|파트너|베타|사전등록|죄송|반영했|적용했|반영할게|적용할게/);
  });

  it.each([true, false])("본문 정리 계층을 지나도 한 글자도 바뀌지 않는다(변경 요청 판정 %s)", (userRequestedChange) => {
    // 라우트는 이 문장을 표식 추출 → 출력 위생 → 저장 주장 검사에 그대로 통과시킨다.
    const extracted = extractAmoraPendingAction({
      text: AMORA_TYPED_CARD_ACCEPTANCE_REPLY,
      allowedTools: [],
      now: Date.now(),
      createActionId: () => "unused",
    });
    expect(extracted.pendingAction).toBeNull();
    expect(extracted.hadPendingActionTag).toBe(false);
    expect(extracted.cleanText).toBe(AMORA_TYPED_CARD_ACCEPTANCE_REPLY);

    const hygiene = applyAmoraOutputHygiene(extracted.cleanText, { userText: "응 적용해줘" });
    expect(hygiene.text).toBe(AMORA_TYPED_CARD_ACCEPTANCE_REPLY);

    const terminal = composeAmoraPersistenceTerminal({
      text: hygiene.text,
      toolResults: [],
      hasPendingAction: false,
      hasEmittedPendingAction: true,
      persistenceMode: "durable",
      userRequestedChange,
      userTurnIsChangeRequest: userRequestedChange,
      droppedPendingActionTag: false,
    });
    expect(terminal.text).toBe(AMORA_TYPED_CARD_ACCEPTANCE_REPLY);
    expect(terminal.corrected).toBe(false);
    // 실패 안내로 읽히면 라우트가 이월 카드를 떼어 버린다.
    expect(isAmoraFailedProposalNotice(terminal.text)).toBe(false);
  });
});
