/**
 * 식당을 방금 찾아 주고서 "업체 검색 기능이 없다" 고 말한다.
 *
 * 2026-09-03 2차 팀 테스트 Turn 10·24. `search_nearby_places` 는 2026-08-22 에 켜졌고
 * 상견례 식당·카페 같은 **일반 장소**를 실제로 찾아 준다(웨딩 업체 질의는 도구 안에서
 * 막힌다). 그런데 `## 업체 추천·예약은 지금 제공하지 않습니다` 섹션은 주어를 그냥
 * "업체" 로 써서, 장소 카드를 보여준 바로 다음 턴에도 "찾아 주는 기능이 없다" 가 나갔다.
 *
 * 이 섹션은 `PRODUCT_SAFETY_HEADINGS` 라 절단으로도, 도구 0개 턴의 `도구` 낱말
 * 필터로도 빠지지 않는다 — 즉 **항상** 실린다. 그래서 문장을 지우는 대신 주어를
 * 웨딩 업체로 한정하고 일반 장소 검색은 해당하지 않는다고 한 줄을 넣었다.
 *
 * 금지(가짜 업체 금지·예약 약속 금지·판정 금지)는 그대로다. 이 파일은 그 금지가
 * 살아 있는지와, 능력을 부정하는 문장마다 주어가 웨딩 업체인지를 함께 잰다.
 */
import { describe, expect, it } from "vitest";

import { buildAmoraSystemPrompt } from "@/lib/ai/amoraPromptComposer";
import { isMutatingTool } from "@/lib/ai/mutationTools";
import { BETA_SAFE_TOOLS } from "@/lib/ai/tools";

const HEADING = "## 업체 추천·예약은 지금 제공하지 않습니다";

const PRODUCTION_ENABLED_TOOL_NAMES = BETA_SAFE_TOOLS
  .filter((tool) => !isMutatingTool(tool.name))
  .map((tool) => tool.name);

const CONTEXT = {
  weddingDate: "2027-05-15",
  budget: 30_000_000,
  venue: null,
  progress: {},
  preparationStatus: null,
  brideName: null,
  groomName: null,
  senderName: "테스트",
  bookings: [],
  scheduleEvents: [],
  chatSummaries: [],
  pastConflicts: [],
  pastDecisions: [],
};

/** 운영이 실제로 만드는 갈래들. 장소 도구가 켜진 턴과 도구 0개 턴을 함께 본다. */
const VARIANTS: Array<{ label: string; enabledToolNames: string[] }> = [
  { label: "운영 도구셋(장소 검색 포함)", enabledToolNames: PRODUCTION_ENABLED_TOOL_NAMES },
  { label: "장소 검색만", enabledToolNames: ["search_nearby_places"] },
  { label: "도구 0개", enabledToolNames: [] },
];

function sectionFor(enabledToolNames: string[]): string {
  const prompt = buildAmoraSystemPrompt(CONTEXT as never, {
    enabledToolNames,
    requestKind: "chat",
    persistenceMode: "durable",
    maxChars: 48_000,
  } as never) as string;
  const start = prompt.indexOf(HEADING);
  expect(start, "보호 섹션이 합성 결과에서 사라졌다").toBeGreaterThan(-1);
  const end = prompt.indexOf("\n## ", start + HEADING.length);
  return end === -1 ? prompt.slice(start) : prompt.slice(start, end);
}

describe("못 한다는 고지의 주어가 웨딩 업체로 한정된다", () => {
  it("일반 장소 검색은 해당하지 않는다고 같은 섹션이 말한다", () => {
    for (const { label, enabledToolNames } of VARIANTS) {
      expect(sectionFor(enabledToolNames), `${label}: 장소 검색과의 경계가 없다`)
        .toContain("일반 장소 검색은 여기 해당하지 않습니다");
    }
  });

  it("능력을 부정하는 문장마다 주어가 웨딩 업체다", () => {
    // 낱말 하나를 세지 않고 **문장 단위**로 묻는다. 주어 없이 "업체를 찾는 도구가
    // 없습니다" 로 되돌아가면 여기서 빨간불이 난다.
    const denialMarkers = ["를 찾거나", "추천이나 예약을 요청받으면", "예약해 드릴게요"];
    for (const { label, enabledToolNames } of VARIANTS) {
      const section = sectionFor(enabledToolNames);
      const sentences = section.split("\n- ");
      for (const marker of denialMarkers) {
        const carrying = sentences.filter((sentence) => sentence.includes(marker));
        expect(carrying.length, `${label}: "${marker}" 를 담은 문장이 없다`).toBeGreaterThan(0);
        for (const sentence of carrying) {
          expect(sentence, `${label}: "${marker}" 문장의 주어가 웨딩 업체로 한정되지 않았다`)
            .toContain("웨딩 업체");
        }
      }
    }
  });

  it("가짜 업체·예약 약속 금지는 그대로 남는다", () => {
    // 주어를 좁히면서 금지를 함께 좁히면 안 된다. 이 세 조각은 다른 파일
    // (`promptToolDrift.test.ts`)도 고정하고 있는 제품 계약이다.
    for (const { label, enabledToolNames } of VARIANTS) {
      const section = sectionFor(enabledToolNames);
      for (const rule of [
        "업체명을 먼저 꺼내지 마세요",
        "찾아볼게요",
        "예약해 드릴게요",
        "절대 가짜 업체 만들지 마세요",
        "점수, 등급, \"최고\", \"보장\"으로 판정하지 마세요",
      ]) {
        expect(section, `${label}: "${rule}" 가 사라졌다`).toContain(rule);
      }
    }
  });
});
