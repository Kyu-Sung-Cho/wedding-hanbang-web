import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { buildAmoraSystemPrompt } from "@/lib/ai/amoraPromptComposer";
import { BETA_SAFE_TOOLS } from "@/lib/ai/tools";
import { isMutatingTool } from "@/lib/ai/mutationTools";

/**
 * 일정 규칙을 `prompts.ts` 에 썼는데 **모델에게 가지 않았다.**
 *
 * ## 무엇이 있었나
 *
 * 2026-08-26, 아모라가 9월 3일 촬영과 겹친다는 것을 발견해 놓고 "어느 날짜가
 * 최종인지 먼저 정리해야 합니다" 로 끝내는 것을 고치려고 `prompts.ts` 의
 * `## 모멘트 일정 캡처` 에 규칙을 넣고 **배포까지 했다.**
 *
 * 그런데 `amoraPromptComposer.ts` 의 `removeLegacyOperationalInstructions` 가
 * `## 도구 사용 핵심 규칙` 부터 `### 카테고리 키` 까지를 **조건 없이 통째로
 * 지운다.** `## 모멘트 일정 캡처`(1314)와 `## 아모라 행동 카드`(1322)가 그 사이
 * (1306~1394)에 있다. 원본 프롬프트에는 있고 모델이 받는 것에는 없다.
 *
 * 같은 함정을 2026-08-24 에 다른 규칙이 이미 한 번 겪었고, 그 기록이
 * `amoraSeesCustomBudgetCategories.test.ts` 주석에 남아 있었다. 이틀 뒤에 내가
 * 같은 자리에 썼다. **기록만으로는 안 막힌다 — 검사가 있어야 한다.**
 *
 * ## 이 검사가 하는 일
 *
 * 원본 문자열을 grep 하지 않는다. **운영이 실제로 넘기는 조건으로 프롬프트를
 * 합성해서** 규칙이 살아남았는지 본다. 이 파일이 통과하는데 규칙이 안 가는
 * 상태는 만들 수 없다.
 */

const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..", "..", "..");

/**
 * **운영이 실제로 넘기는 집합.** 쓰기 도구는
 * `availableTools = runnableTools.filter((t) => !isMutatingTool(t.name))` 에서
 * 걸러져 `enabledToolNames` 에 오지 않는다. 손으로 도구 이름을 넣으면 그 이름으로
 * 건 안내가 운영에서 한 번도 안 나가는데도 검사는 초록이 된다.
 */
const PRODUCTION_ENABLED_TOOL_NAMES = BETA_SAFE_TOOLS
  .filter((tool) => !isMutatingTool(tool.name))
  .map((tool) => tool.name);

function deliveredPrompt(): string {
  return buildAmoraSystemPrompt(
    {
      weddingDate: "2027-05-15",
      budget: 50_000_000,
      venue: null,
      progress: {},
      preparationStatus: null,
      brideName: "신부",
      groomName: "신랑",
      bookings: [],
      scheduleEvents: [
        {
          id: "evt_abc123",
          date: "2026-09-03",
          title: "웨딩 사진 촬영",
          categoryKey: "studio",
          memo: null,
        },
      ],
      chatSummaries: [],
      pastConflicts: [],
      pastDecisions: [],
      senderName: "신부",
    } as never,
    {
      enabledToolNames: PRODUCTION_ENABLED_TOOL_NAMES,
      requestKind: "chat",
      persistenceMode: "durable",
    } as never,
  );
}

describe("측정기가 살아 있다", () => {
  it("프롬프트가 실제로 합성된다", () => {
    const prompt = deliveredPrompt();
    expect(prompt.length, "합성 결과가 비었다 — 아래 검사가 전부 무의미하다").toBeGreaterThan(2_000);
  });

  it("삭제되는 구간이 실제로 삭제된다 — 이게 아니면 이 검사가 지킬 것이 없다", () => {
    const prompt = deliveredPrompt();
    // 이 헤딩들은 `prompts.ts` 원본에는 있지만 모델이 받는 것에는 없어야 한다.
    expect(prompt, "삭제 구간이 살아 있다 — 전제가 바뀌었으니 이 파일을 다시 보라")
      .not.toContain("## 도구 사용 핵심 규칙");
    expect(prompt).not.toContain("## 모멘트 일정 캡처");
  });

  it("원본에는 그 헤딩이 있다 — 삭제가 일어난다는 증거", () => {
    const source = readFileSync(join(REPO_ROOT, "apps", "web", "src", "lib", "ai", "prompts.ts"), "utf8");
    expect(source).toContain("## 모멘트 일정 캡처");
  });
});

describe("일정 겹침 규칙이 모델에게 간다", () => {
  it("같은 일이 이미 있으면 옮기기를 제안하라는 규칙이 살아 있다", () => {
    const prompt = deliveredPrompt();
    // **`update_schedule_event` 나 `### 등록된 일정` 으로 물으면 안 된다.** 둘 다
    // 프롬프트 다른 곳에도 있어서, 이 규칙을 통째로 지워도 그 문자열들이 대신
    // 답한다(변형 검사에서 실제로 뚫렸다). 이 규칙에만 있는 문구로 묻는다.
    expect(prompt, "규칙이 지워지는 구간에 있거나 삭제됐다")
      .toContain("옮기자고 제안하고");
    expect(prompt, "옮길 대상을 고를 근거(일정 id의 위치)를 안 알려준다")
      .toContain("일정 id는 `### 등록된 일정`의 각 줄 앞에 있습니다");
    // 어느 도구를 쓸지 가르는 낱말도 있어야 한다 — 없으면 모델이 늘 add 만 한다.
    expect(prompt).toContain("바꿨어·옮겼어·변경했어");
  });

  it("말로만 알리고 끝내지 말라는 금지가 살아 있다", () => {
    expect(deliveredPrompt()).toContain("말로만 알리고 끝내지 마세요");
  });

  it("'같은 일인지 애매' 를 '값이 모호' 와 구분해 준다", () => {
    // 카드 계약문이 두 번 "값이 모호하면 표식 없이 되물으세요" 라고 한다
    // (amoraPendingAction.ts:970·977). 2026-08-26 운영 실측에서 모델이 "같은
    // 피팅 일정인지 확인이 필요해요" 를 그 면제 조항으로 읽고 카드를 안 냈다.
    // 그 둘이 다르다는 것을 명시해야 표식이 나온다.
    const prompt = deliveredPrompt();
    expect(prompt, "애매함과 값 모호를 구분해 주지 않는다")
      .toContain("값이 모호한 것이 아닙니다");
    // 예전에는 "본문에 '다른 일정이면 말씀해 주세요' 를 덧붙여라" 였는데, 표식이
    // 있으면 본문이 사라지므로 그 단서는 사용자에게 절대 안 보였다. 이제 카드가
    // expected_* 로 스스로 무엇을 바꾸는지 말한다.
    expect(prompt).toContain("무엇을 바꾸려는지 카드가 스스로 말하게");
  });

  it("설명을 title·memo 에 담으라고 시키지 않는다 — 그 둘은 일정을 덮어쓴다", () => {
    /**
     * 어제 여기에 "꼭 필요한 정보는 표식의 `title`·`memo` 같은 필드에 담으세요" 를
     * 썼다. **위험한 지시였다** — `update_schedule_event` 에서 그 둘은 화면 문구가
     * 아니라 저장된 일정을 그대로 덮어쓴다(`updates.memo = ...`, 병합 아님).
     * 모델이 설명문을 거기 담으면 사용자가 직접 쓴 메모가 지워진다.
     */
    const prompt = deliveredPrompt();
    expect(prompt, "설명을 title·memo 에 담으라고 시킨다")
      .not.toMatch(/필요한 정보는 표식의 `title`·`memo`/u);
    expect(prompt, "그 둘이 일정을 덮어쓴다는 경고가 없다")
      .toContain("저장된 일정 자체를 덮어씁니다");
  });

  it("본문에 한 문장 덧붙이라고 시키지 않는다 — 표식이 있으면 본문이 사라진다", () => {
    // 계약문이 자기 안에서 모순돼 있었다: 한 줄은 "본문에 덧붙여라", 다른 줄은
    // "본문은 남지 않는다". 그래서 아모라가 확신 없음을 알려도 사용자에겐 안 보였다.
    const prompt = deliveredPrompt();
    expect(prompt).not.toContain("한 문장을 덧붙이세요");
    // 대신 카드가 스스로 말하게 한다.
    expect(prompt).toContain("카드가 스스로 말하게");
  });

  it("본문에 덧붙인 설명이 사라진다는 것을 알려준다", () => {
    // 여기 원래 "답변 본문에 두 갈래를 적으라" 는 규칙을 검사했다. 그 규칙 자체가
    // 틀렸다 — `extractAmoraPendingAction` 이 표식을 찾으면
    // `cleanText: marker.confirmation` 으로 본문을 갈아치운다. 운영 실측으로도
    // 카드가 붙은 AI 메시지 37/37 이 서버 정형 문구뿐이었다.
    const prompt = deliveredPrompt();
    expect(prompt).toContain("본문에 덧붙인 설명은 남지 않습니다");
  });

  it("등록된 일정 블록이 event_id 와 함께 실린다 — 옮길 대상을 못 고르면 규칙이 무의미하다", () => {
    const prompt = deliveredPrompt();
    expect(prompt).toContain("evt_abc123");
    expect(prompt).toContain("웨딩 사진 촬영");
  });
});

describe("규칙을 지워지는 자리에 다시 쓰지 않는다", () => {
  it("prompts.ts 의 삭제 구간에 일정 겹침 규칙이 없다", () => {
    const source = readFileSync(join(REPO_ROOT, "apps", "web", "src", "lib", "ai", "prompts.ts"), "utf8");
    const start = source.indexOf("## 도구 사용 핵심 규칙");
    const end = source.indexOf("### 카테고리 키");
    expect(start, "시작 헤딩을 못 찾았다").toBeGreaterThan(0);
    expect(end, "끝 헤딩을 못 찾았다").toBeGreaterThan(start);

    const dead = source.slice(start, end);
    for (const rule of ["말로만 알리고 끝내지", "옮기자고 제안하세요", "답변 본문에"]) {
      expect(dead, `"${rule}" 이 모델에게 안 가는 구간에 있다`).not.toContain(rule);
    }
  });
});
