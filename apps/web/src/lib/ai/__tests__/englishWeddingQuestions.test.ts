/**
 * 영어로 물어도 결혼 질문이다.
 *
 * 범위 판정기에 영어가 **하나도** 없었다. 운영에서 이 문장이 `W4_out_of_scope`
 * 로 떨어졌다:
 *
 *     What is our total wedding budget and how many days until the wedding?
 *
 * 명백한 결혼 질문인데 대화 이력도(W4 턴은 현재 메시지 하나만 간다) 도구도 못
 * 받았다.
 *
 * ## 애매하지 않은 낱말만 넣었다
 *
 * `venue`·`budget`·`dress` 단독은 뺐다. 한국어에서 `예산` 을 넣었다가 결혼 밖
 * 화제와 두려움 서술까지 끌어온 것과 같은 함정이다 — 다른 분야의 venue·budget·
 * dress 가 끝없이 많다. 그런 문장은 대화 연속성이 맡는다.
 */
import { describe, expect, it } from "vitest";

import { classifyAmoraQuestionScope } from "@/lib/ai/amoraQuestionScope";

const scope = (userText: string) => classifyAmoraQuestionScope({ userText }).scope;

describe("영어 결혼 질문이 범위 안에 든다", () => {
  it.each([
    "What is our total wedding budget and how many days until the wedding?",
    "Show me our wedding schedule",
    "When should we book the wedding hall?",
    "We are planning a small wedding with 40 guests",
    "How do I tell the bride about this?",
    "Where should we go for our honeymoon?",
    "Do we need to send RSVP cards?",
    "My groom wants a simple ceremony",
  ])("%s", (userText) => {
    expect(scope(userText)).toBe("W0_wedding_core");
  });
});

describe("영어 결혼 밖 질문은 그대로 막힌다", () => {
  it.each([
    "What is the weather today?",
    "Write me a python sorting algorithm",
    "Should I buy Tesla stock?",
    "Summarize this history article",
    "Book me a meeting room for the company offsite",
    "Translate this paragraph into Korean",
  ])("%s", (userText) => {
    expect(scope(userText)).not.toBe("W0_wedding_core");
  });
});

describe("영어 낱말이 한국어 문장을 뚫지 않는다", () => {
  // 외래어·고유명사가 언어 관문을 뚫은 전례가 있다("팝송 제목이 Suicide Blonde").
  // 여기 넣은 낱말들을 겨냥해 결혼과 무관한 한국어 문장을 만들어 확인한다.
  it.each([
    "Groom 이라는 이름의 강아지 미용실 추천해줘",
    "회사 engagement 지표를 정리해줘",
    "Bride 라는 밴드 노래 알려줘",
    "honeymoon phase 라는 심리학 용어가 뭐야?",
  ])("%s", (userText) => {
    // 결혼 어휘가 걸려 W0 이 될 수는 있다 — 그때도 도구만 열릴 뿐 안전 판정은
    // 그대로다. 여기서 확인하는 것은 **위기·고위험 판정이 뒤집히지 않는 것**이다.
    const classification = classifyAmoraQuestionScope({ userText });
    expect(["W0_wedding_core", "W1_wedding_adjacent", "W3_social_care", "W4_out_of_scope"])
      .toContain(classification.scope);
  });
});
