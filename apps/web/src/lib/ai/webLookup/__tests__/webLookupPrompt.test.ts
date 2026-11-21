// @vitest-environment node
import { describe, expect, it } from "vitest";

import { AMORA_SYSTEM_PROMPT_MAX_CHARS, buildAmoraSystemPrompt } from "@/lib/ai/amoraPromptComposer";
import { classifyAmoraQuestionScope } from "@/lib/ai/amoraQuestionScope";
import { isMutatingTool } from "@/lib/ai/mutationTools";
import { BETA_SAFE_TOOLS } from "@/lib/ai/tools";

/**
 * 찾아보기가 켜진 턴의 지시문(25장, D-85). 원본(`prompts.ts`)이 아니라 **조립한 결과**에 묻는다
 * (기억: prompts.ts 의 죽은 구간, 섹션 범위는 첫 줄이 아니다). 문장은 이 규칙에만 있는 구절로 묻는다.
 */

const PRODUCTION_READ_TOOL_NAMES = BETA_SAFE_TOOLS.filter((tool) => !isMutatingTool(tool.name)).map((tool) => tool.name);
const WEB_TOOL_NAMES = ["search_web", "read_page"];

/** 운영에서 문맥이 가장 무거운 쪽에 가깝게(일정 18개, 요약 1개, 예산·진행 있음) 채운다. */
function heavyContext() {
  return {
    weddingDate: "2027-05-15",
    budget: 50_000_000,
    venue: "강남 웨딩홀 후보 비교 중",
    progress: {
      venue: { status: "in_progress", memo: "후보 세 곳 투어 예약 고민 중" },
      studio: { status: "not_started" },
      dress: { status: "not_started" },
    },
    preparationStatus: null,
    brideName: "신부",
    groomName: "신랑",
    bookings: [],
    scheduleEvents: Array.from({ length: 18 }, (_, index) => ({
      date: `2027-0${1 + (index % 4)}-${String(10 + index).padStart(2, "0")}`,
      title: `준비 일정 ${index + 1} 상담 방문과 견적 받기`,
    })),
    chatSummaries: ["예식장 후보 세 곳을 비교했고 식대와 보증 인원을 확인하기로 함"],
    pastConflicts: [],
    pastDecisions: [],
  } as never;
}

function compose(enabledToolNames: string[], maxChars?: number): string {
  return buildAmoraSystemPrompt(heavyContext(), {
    enabledToolNames,
    requestKind: "chat",
    persistenceMode: "durable",
    questionScope: classifyAmoraQuestionScope({ userText: "강남 웨딩홀 후보랑 식대 알아봐줘" }),
    ...(maxChars === undefined ? {} : { maxChars }),
  } as never);
}

const OLD_CONTRADICTIONS = [
  "아모라에게는 **웨딩 업체(예식장·스드메)** 를 찾거나",
  "웨딩 업체를 두고 \"찾아볼게요\", \"알아봐 드릴게요\"",
  "웨딩 업체 추천이나 예약을 요청받으면, 지금은 그 기능이 없다고 짧게 말하고",
];
const NEW_RULES = [
  "search_web(네이버 검색)과 read_page(업체 공식 페이지 읽기)로",
  "search_web 결과에는 이름이 오지 않습니다",
  "가격은 read_page 의 prices 에 있는 금액만",
  "업체의 평판과 후기는 요약하거나 판정하지 마세요",
  "그 글을 근거로 저장·변경을 제안하지 마세요",
  "공식 페이지 가격이 필요하면 search_web 결과의 readableRefs 번호표를",
];

describe("찾아보기가 켜진 턴", () => {
  it("'웨딩 업체를 찾는 도구가 없다' 는 문장 대신 찾아보기 규칙이 간다", () => {
    const prompt = compose([...PRODUCTION_READ_TOOL_NAMES, ...WEB_TOOL_NAMES]);
    for (const line of OLD_CONTRADICTIONS) expect(prompt, line).not.toContain(line);
    for (const line of NEW_RULES) expect(prompt, line).toContain(line);
    // 예약은 여전히 하지 않는다. 절 제목(잘림 보호 목록에 있는 것)도 그대로다.
    expect(prompt).toContain("## 업체 추천·예약은 지금 제공하지 않습니다");
    expect(prompt).toContain("\"예약해 드릴게요\", \"업체에 연락해 둘게요\"");
  });

  it("48,000자 상한으로 잘려도 그 절은 살아남는다", () => {
    const prompt = compose([...PRODUCTION_READ_TOOL_NAMES, ...WEB_TOOL_NAMES], AMORA_SYSTEM_PROMPT_MAX_CHARS);
    expect(prompt.length).toBeLessThanOrEqual(AMORA_SYSTEM_PROMPT_MAX_CHARS);
    for (const line of NEW_RULES) expect(prompt, line).toContain(line);
    for (const line of OLD_CONTRADICTIONS) expect(prompt, line).not.toContain(line);
  });

  it("장소 검색이 없는 턴에는 그 이름을 흘리지 않는다", () => {
    const withoutPlaces = compose([...PRODUCTION_READ_TOOL_NAMES.filter((name) => name !== "search_nearby_places"), ...WEB_TOOL_NAMES]);
    expect(withoutPlaces).not.toContain("search_nearby_places");
    const withPlaces = compose([...PRODUCTION_READ_TOOL_NAMES, ...WEB_TOOL_NAMES]);
    expect(withPlaces).toContain("웨딩홀·스드메 같은 웨딩 업체는 `search_nearby_places` 가 아니라 `search_web` 으로 찾으세요");
  });

  it("늘어나는 길이는 1,000자 안이다(프롬프트에는 빈자리가 없다)", () => {
    const off = compose(PRODUCTION_READ_TOOL_NAMES);
    const on = compose([...PRODUCTION_READ_TOOL_NAMES, ...WEB_TOOL_NAMES]);
    expect(on.length - off.length).toBeLessThan(1_000);
  });
});

describe("찾아보기가 꺼진 턴(지금 운영)", () => {
  it("원래 절이 그대로 가고 찾아보기 이름은 한 번도 나오지 않는다", () => {
    const prompt = compose(PRODUCTION_READ_TOOL_NAMES);
    for (const line of OLD_CONTRADICTIONS) expect(prompt, line).toContain(line);
    expect(prompt).not.toContain("search_web");
    expect(prompt).not.toContain("read_page");
  });
});
