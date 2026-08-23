// @vitest-environment node

/**
 * 목소리 계약이 아니라 **도달**을 지킨다.
 *
 * `amoraVoice.ts`는 이미 다정하게 쓰여 있었는데도 사용자가 만나는 문장은 사무적이었다.
 * 계약과 화면 사이에서 세 군데가 새고 있었기 때문이다 — 아모라의 자기소개, 변경이
 * 실패했을 때의 문구, 그리고 가장 무거운 순간인 위기 카드. 여기서 그 셋을 고정한다.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = resolve(process.cwd());
const source = (relativePath: string) =>
  readFileSync(resolve(appRoot, relativePath), "utf8");

const prompts = source("src/lib/ai/prompts.ts");
const voice = source("src/lib/ai/amoraVoice.ts");
const profilePrompt = source("src/lib/ai/amora-profile.ts");
const communityPrompt = source("src/app/api/community/ai-comment/route.ts");
const aiNotice = source("src/components/common/AiNoticeFooter.tsx");
const toolExecutor = source("src/lib/ai/toolExecutor.ts");
const chatContent = source("src/components/app/chat/ChatContent.tsx");

describe("아모라 정체성이 프롬프트와 사용자 표면에서 같은 말을 한다", () => {
  it("아모라를 '플래너'로 소개하지 않는다", () => {
    // 2026-08-09 파운더 확정: 아모라는 대행하는 플래너가 아니라 함께 걷는 파트너다.
    // 모델이 자기 역할을 대행자로 잡으면 어미·거리감·정보 밀도가 전부 그 프레임을
    // 따라가므로, 이건 카피가 아니라 목소리 문제다.
    for (const [label, text] of [
      ["시스템 프롬프트", prompts],
      ["목소리 계약", voice],
      ["프로필 편집기 프롬프트", profilePrompt],
      ["커뮤니티 댓글 프롬프트", communityPrompt],
    ] as const) {
      expect(text, `${label}가 아모라를 플래너로 소개한다`)
        .not.toMatch(/아모라(는|입니다|의)?[^.\n]{0,20}(웨딩\s*)?플래너/u);
      expect(text, `${label}가 아모라를 플래너로 소개한다`)
        .not.toMatch(/(웨딩|AI)\s*플래너\s*(['"`*]*아모라|아모라)/u);
    }
  });

  it("아모라를 '파트너'라고도 부르지 않는다", () => {
    // 정본 호칭은 "결혼 준비 동반자"다(wedding/CLAUDE.md). 이 제품에서 "파트너"는
    // **배우자될 사람**을 가리키고, 그 단어는 고위험 안전 정규식에도 가해자를 가리키는
    // 명사로 들어 있다(lib/ai/amoraQuestionScope.ts). 모델이 자기를 그렇게 부르면
    // "파트너가 때렸어" 같은 문장에서 주어가 누구인지가 흐려진다 — 라벨 문제가 아니라
    // 의미 충돌이다.
    for (const [label, text] of [
      ["시스템 프롬프트", prompts],
      ["목소리 계약", voice],
      ["프로필 편집기 프롬프트", profilePrompt],
      ["커뮤니티 댓글 프롬프트", communityPrompt],
    ] as const) {
      expect(text, `${label}가 아모라를 파트너로 소개한다`).not.toMatch(
        /(AI|웨딩)\s*파트너\s*(['"`*]*아모라|아모라)?/u,
      );
    }
  });

  it("자기소개와 역할 정의가 서로 다른 말을 하지 않는다", () => {
    expect(prompts).toContain("결혼 준비를 함께 걷는 AI 동반자입니다");
    expect(voice).toContain("결혼 준비를 함께 걷는 AI 동반자입니다");
    // 사람인 척 금지는 개명과 무관하게 남아 있어야 한다. "지인처럼"이지 "지인인 척"이 아니다.
    expect(voice).toContain("사람인 척하거나 실제 결혼·상담 경험을 지어내지 마세요");
  });

  it("법적 AI 고지가 모델의 자기소개와 같은 이름을 쓴다", () => {
    // 고지와 자기소개가 서로 다른 이름을 말하는 상태는 개명 전보다 나쁘다.
    expect(aiNotice).toContain("AI 동반자");
    expect(aiNotice).not.toContain("AI 플래너");
    expect(aiNotice).not.toContain("AI 파트너");
  });

  it("실행 위임 문장은 그대로 둔다", () => {
    // 이 문장을 약화시켰다가 모델이 도구를 호출하지도 표식하지도 못하는 상태에서
    // "기능이 연결돼 있지 않다"는 허위 응답을 만든 사고가 있었다(운영 E2E로 확인).
    expect(prompts).toContain(
      "대화 안에서 도구로 직접 데이터를 수정/조회하는 것이 핵심 역할",
    );
  });
});

describe("변경이 실패했을 때 아모라가 시스템 로그처럼 말하지 않는다", () => {
  // failureResult(toolName, toolInput, "CODE", "문구") 의 마지막 인자를 전부 모은다.
  const failureCopy = [
    ...toolExecutor.matchAll(
      /failureResult\(\s*\w+,\s*\w+,\s*"([A-Z_]+)",\s*\n?\s*"([^"]+)"/gu,
    ),
  ].map(([, code, message]) => ({ code, message }));

  it("변경 실패 문구를 하나도 놓치지 않고 검사한다", () => {
    // 검사 대상이 조용히 0건이 되면 이 테스트는 아무것도 지키지 않는다.
    expect(failureCopy.length).toBeGreaterThanOrEqual(11);
  });

  it("반영되지 않았다는 사실을 문구 안에서 말한다", () => {
    // 사용자가 화면에서 확인할 수 있는 유일한 사실 진술이다. 실패했는데 실패로
    // 읽히지 않으면 같은 변경을 다시 요청해 이중 반영을 시도하게 된다.
    for (const { code, message } of failureCopy) {
      expect(message, `${code} 문구에 반영되지 않았다는 절이 없다`)
        .toMatch(/(않았어요|않고 멈췄어요|못했어요)/u);
    }
  });

  it("내부 장치 이름을 사용자에게 노출하지 않는다", () => {
    // '요청 식별자', '도구 입력 형식', '중복 방지 장치'는 우리 어휘지 사용자 어휘가 아니다.
    // 내부 오류 원문 노출 금지(CLAUDE.md)와도 맞물린다.
    for (const { code, message } of failureCopy) {
      for (const internalTerm of [
        "식별자",
        "도구 입력",
        "중복 방지 장치",
        "멱등",
        "원장",
        "ledger",
        "idempotency",
      ]) {
        expect(message, `${code} 문구가 내부 어휘 '${internalTerm}'를 노출한다`)
          .not.toContain(internalTerm);
      }
    }
  });

  it("아모라의 말투를 쓴다", () => {
    for (const { code, message } of failureCopy) {
      expect(message, `${code} 문구가 격식체로 끝난다`)
        .not.toMatch(/(습니다|입니다)\.?\s*$/u);
    }
  });
});

describe("위기 카드가 아모라의 메시지로 보인다", () => {
  // 삼항의 참(true) 가지만 잘라낸다. 고정 길이로 자르면 거짓 가지의 <ChatBubble>까지
  // 딸려 들어와, 카드가 멀쩡한데도 실패하는 가짜 경보가 된다(실제로 그랬다).
  const cardStart = chatContent.indexOf("{isPinnedSafetyCard ? (");
  const cardEnd = chatContent.indexOf(") : (", cardStart);
  const card = chatContent.slice(cardStart, cardEnd);
  // 주석은 벗기고 본다. 왜 ChatBubble을 재사용하지 않는지 설명하려면 그 이름을 적어야
  // 하는데, 자기 설명에 걸려 넘어지는 가드는 가드가 아니다(이 저장소에서 네 번째다).
  const cardMarkup = card
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/gu, "")
    .replace(/^[\t ]*\/\/.*$/gmu, "");

  it("위기 카드 분기를 실제로 찾았다", () => {
    expect(cardStart).toBeGreaterThan(-1);
    expect(cardEnd).toBeGreaterThan(cardStart);
    expect(card).toContain('data-amora-safety-card="true"');
  });

  it("아모라의 이름표와 아바타를 함께 보여준다", () => {
    // 제품에서 감정적으로 가장 무거운 메시지가 유일하게 이름 없이 나가고 있었다.
    // 모바일은 이미 이 카드에도 이름표를 붙인다.
    //
    // ⚠️ 주석을 벗긴 마크업에서, 그리고 **렌더되는 엘리먼트** 형태로 검사한다.
    //    `card`에 낱말만 있는지 보면 이 주석 자체가 단언을 통과시킨다 —
    //    실제로 이름표를 지우는 변이(M7)를 놓쳤다.
    expect(cardMarkup).toMatch(/<span[^>]*>\s*아모라\s*<\/span>/u);
    expect(cardMarkup).toContain("Sparkles");
  });

  it("경고 삼각형이 아니라 방패를 쓴다", () => {
    // 시각 언어가 에러 배너와 같으면, 곁에 있는 사람이 걱정하는 게 아니라
    // 시스템이 사용자를 위험군으로 표시한 것처럼 읽힌다.
    expect(cardMarkup).toContain("ShieldCheck");
    expect(cardMarkup).not.toContain("AlertTriangle");
  });

  it("색과 접근성 계약은 그대로 유지한다", () => {
    // 의미만 바꾸고 중요도·대비는 낮추지 않는다.
    expect(card).toContain("border-danger-500/30");
    expect(card).toContain("text-danger-500");
    expect(card).toContain("text-danger-700");
    expect(card).toContain('role="alert"');
    expect(card).toContain('aria-live="assertive"');
    expect(card).toContain('aria-label="긴급 안전 안내"');
  });

  it("저장·피드백 어포던스를 붙이지 않는다", () => {
    // 이 카드는 ephemeral_local_only다. ChatBubble을 재사용하면 저장 버튼이 따라붙어
    // 본문이 서버에 영구 저장된다.
    expect(cardMarkup).not.toContain("ChatBubble");
    expect(cardMarkup).not.toContain("SaveNoteButton");
    expect(cardMarkup).not.toContain("onNegativeFeedback");
  });

  it("마크다운 파이프라인을 태우지 않는다", () => {
    // 전화번호가 마크다운 변환에 노출되면 안 된다. 평문 렌더를 유지한다.
    expect(cardMarkup).toContain("whitespace-pre-wrap");
    expect(cardMarkup).not.toContain("renderAiMarkdown");
    expect(cardMarkup).not.toContain("parseEtiquetteTags");
  });
});

describe("두 사람 사이를 가르지 않는다", () => {
  // 2026-08-22 운영 실측. "둘이 계속 싸우기만 해. 그냥 네가 정해줘. 호텔이야 스몰웨딩이야?"
  // 에 아모라가 "하나만 고르라면 ○○을 먼저 권할게요"로 답했다. 함께 대화라 상대도 읽는다.
  //
  // 버그가 아니라 규칙이 시킨 것이었다 — `AMORA_CARE_VOICE` 의 "결정" 역할이 "비교·추천·판단을
  // 명확히 요청했다면 결론부터"라고 하는데, 그 규칙이 **선택지 중 고르기**와 **두 사람 중
  // 편들기**를 구분하지 않았다. 랜딩은 "아모라는 대신 결정하지 않고"를 약속한다.
  //
  // 중립 규칙 자체는 있었지만 `AMORA_MEDIATION_TURN_GUARD` 안이라 구조화 중재 요청에만
  // 붙었다. 평범한 대화 턴에는 아무것도 붙지 않았다.
  it("keeps the couple-neutrality carve-out in the always-attached voice, not only in mediation", () => {
    const decisionRole = voice.slice(
      voice.indexOf("- **결정**"),
      voice.indexOf("- **실행**"),
    );
    expect(decisionRole.length).toBeGreaterThan(0);
    expect(decisionRole).toContain("두 사람의 의견이 갈린 자리");
    expect(decisionRole).toContain("한쪽 손을 들어주지 마세요");
    // 밀어붙이는 말들을 그대로 적어 둔다. 모델이 "정해줘"만 막고 "누구 말이 맞아"는
    // 통과시키는 일이 없도록.
    expect(decisionRole).toContain("네가 정해줘");
    expect(decisionRole).toContain("누구 말이 맞아");
    // 사물 비교까지 막으면 제품이 쓸모를 잃는다. 예외의 경계를 함께 고정한다.
    expect(decisionRole).toContain("사물");
  });

  it("still attaches that voice on every turn", () => {
    // 규칙이 아무리 좋아도 프롬프트에 실리지 않으면 없는 것이다.
    expect(prompts).toContain("${AMORA_CARE_VOICE}");
  });
});
