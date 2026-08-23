// @vitest-environment node

/**
 * 아모라가 **자기가 누구인지**와 **무엇을 하지 않는지**를 말할 수 있어야 한다.
 *
 * ## 두 구멍은 같은 자리에서 나왔다
 *
 * 서버 범위 판정을 직접 재보니(2026-08-23) 아래가 전부 `W4_out_of_scope` 의
 * **모호 갈래**(needsClarification=true)로 떨어진다.
 *
 *     너 챗지피티야?  /  누가 만들었어?  /  파이썬으로 피보나치 짜줘
 *
 * 이 갈래는 일부러 따뜻하게 쓰여 있고, 닫아두는 것을 **도구·저장·단정** 셋으로 적어
 * 놨다. 과업 수행 자체는 닫혀 있지 않았다. 그래서:
 *
 * 1. 정체성 질문에 **정해진 답이 없어** 모델이 자기 학습된 정체로 돌아간다.
 *    실제로 "저는 OpenAI의 ChatGPT예요"가 나왔다.
 * 2. 코딩 요청을 그냥 수행한다. 어휘 목록은 `Python`은 잡고 `파이썬`은 놓친다 —
 *    한국어 서비스인데 한국 사용자가 쓰는 표기가 빠져 있었다.
 *
 * ## 어휘를 넓히지 않은 이유
 *
 * `파이썬|자바스크립트|타입스크립트` + 동사를 목록에 더해봤다. 그러자
 * "파이썬 개발자 친구한테 청첩장 만들어달라고 할까?"처럼 **낱말이 든 평범한 결혼
 * 문장**이 같이 걸린다. 창 크기를 좁혀 맞추면 내가 쓴 예문 두 개에만 맞을 뿐이다.
 * 그래서 목록이 아니라 **불확실할 때의 태도**에 규칙을 뒀다. 아래 회귀 검사가 그
 * 결정을 고정한다.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildAmoraQuestionScopeInstruction,
  classifyAmoraQuestionScope,
} from "../amoraQuestionScope";
import { getWeddingPlannerSystemPrompt } from "../prompts";

const baseContext = {
  weddingDate: null,
  budget: 0,
  venue: null,
  progress: {},
  bookings: [],
  brideName: null,
  groomName: null,
  senderName: "민이",
  scheduleEvents: [],
  chatSummaries: [],
};

const instructionFor = (userText: string) =>
  buildAmoraQuestionScopeInstruction(classifyAmoraQuestionScope({ userText }));

/** 사용자가 "범위 밖"이라는 차가운 통보를 받는 갈래인가. */
const isColdOutOfScope = (userText: string) =>
  instructionFor(userText).includes("범위를 짧고 자연스럽게");

describe("아모라가 자기 정체를 다른 회사 제품으로 말하지 않는다", () => {
  it("이름·소속·기술을 묻는 답이 시스템 프롬프트에 실제로 닿는다", () => {
    const prompt = getWeddingPlannerSystemPrompt(baseContext);

    // 소스에만 있고 프롬프트에 안 닿으면 아무것도 지키지 못한다.
    expect(prompt).toContain("웨딩한방의 아모라");
    expect(prompt).toContain("다른 회사의 제품으로 말하지 마세요");
    expect(prompt).toContain("ChatGPT");
  });

  it("숨기라고 시키지 않는다 — 공개 고지문과 같은 말을 한다", () => {
    // /ai-policy 는 "아모라는 OpenAI GPT-5.6 Luna·Terra를 이용하고"라고 공개한다.
    // 프롬프트가 이를 숨기라고 하면 제품이 두 곳에서 다른 말을 하게 된다.
    const prompt = getWeddingPlannerSystemPrompt(baseContext);
    const policyPage = readFileSync(
      resolve(process.cwd(), "src/app/ai-policy/page.tsx"),
      "utf8",
    );

    expect(policyPage).toContain("OpenAI");
    expect(prompt).toContain("OpenAI 모델을 이용한다는 사실은 그대로 말하세요");
  });
});

describe("결혼 준비 밖의 대행을 하지 않는다", () => {
  // 한글 표기가 어휘 목록을 비껴가 모호 갈래로 오는 문장들이다.
  const OFF_DOMAIN = [
    "파이썬으로 피보나치 짜줘",
    "자바스크립트로 정렬 함수 만들어줘",
    "타입스크립트 타입 좀 고쳐줘",
    "정규식 하나 만들어줘",
    "영어 이메일 좀 써줘",
    "내일 서울 날씨 어때?",
  ];

  it.each(OFF_DOMAIN)("모호 갈래가 대행을 막는다: %s", (userText) => {
    expect(instructionFor(userText)).toContain("결혼 준비와 분명히 무관한 대행은 하지 마세요");
  });

  it("결혼 준비의 글쓰기까지 막지 않는다", () => {
    // 이 단서가 없으면 청첩장 문구·감사 인사 요청이 같은 금지에 걸린다.
    // 문구 작성은 아모라의 '실행' 역할에 이미 들어 있는 일이다.
    const instruction = instructionFor("파이썬으로 피보나치 짜줘");
    expect(instruction).toContain("결혼 준비의 글쓰기는 그대로 도와드리세요");
    expect(instruction).toContain("청첩장 문구");
  });

  it("닫아두던 것은 그대로 닫혀 있다", () => {
    const instruction = instructionFor("파이썬으로 피보나치 짜줘");
    expect(instruction).toContain("도구 실행과 장기 기억 저장은 하지 마세요");
    expect(instruction).toContain("실행을 시작하지 말고");
  });

  it("이미 목록에 있던 요청은 차가운 갈래가 계속 막는다", () => {
    // "주식 뭐 사야 해?"는 needsClarification=false 라 차가운 갈래로 간다. 거기엔
    // 원래부터 수행 금지가 있었다. 새 줄은 **모호 갈래의 구멍**만 메운다.
    expect(isColdOutOfScope("주식 뭐 사야 해?")).toBe(true);
    expect(instructionFor("주식 뭐 사야 해?")).toContain("범위 밖 과업을 실질적으로 수행하지 말고");
  });

  it("따뜻한 태도를 그대로 둔다", () => {
    // 이 갈래는 서버가 판단을 못 한 경우다. 사용자가 잘못 말한 게 아니다.
    // 금지 한 줄을 넣느라 판정형 되물음으로 되돌아가면 안 된다.
    const instruction = instructionFor("요즘 너무 지쳐");
    expect(instruction).toContain("먼저 사람처럼 반응하세요");
    expect(instruction).toContain("판정형 되물음을 쓰지 마세요");
  });
});

describe("어휘를 넓히지 않았다 — 낱말이 든 평범한 결혼 문장은 그대로 열려 있다", () => {
  // 목록에 `파이썬` 류를 더하려다 버린 결정을 여기서 고정한다. 누가 나중에
  // OUT_OF_SCOPE_TASK_PATTERN 에 낱말을 더하면 이 검사가 먼저 깨진다.
  const ORDINARY_WEDDING_TALK = [
    "신랑이 파이썬 개발자라 결혼식에 회사 동료가 많이 와",
    "청첩장에 남편 직업을 자바스크립트 개발자라고 써도 될까?",
    "파이썬 개발자 친구한테 청첩장 만들어달라고 할까?",
    "타입스크립트 하는 친구가 축가 불러준대",
    "결혼식 프로그램 짜줘",
    "사회자 스크립트 좀 써줘",
    "식순 좀 만들어줘",
  ];

  it.each(ORDINARY_WEDDING_TALK)("차가운 '범위 밖' 통보를 받지 않는다: %s", (userText) => {
    expect(isColdOutOfScope(userText)).toBe(false);
  });
});
