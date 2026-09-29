/**
 * 식당을 방금 찾아 주고서 "업체 검색 기능이 없다" 고 말한다.
 *
 * 2026-09-03 2차 팀 테스트 Turn 10·24. `search_nearby_places` 는 2026-08-22 에 켜졌고
 * 상견례 식당·카페 같은 **일반 장소**를 실제로 찾아 준다(웨딩 업체 질의는 도구 안에서
 * 막힌다). 그런데 `## 업체 추천·예약은 지금 제공하지 않습니다` 섹션은 주어를 그냥
 * "업체" 로 써서, 장소 카드를 보여준 바로 다음 턴에도 "찾아 주는 기능이 없다" 가 나갔다.
 *
 * 비활성 턴의 섹션은 웨딩 업체로 주어를 한정한다. 2026-09-28 이후
 * `discover_providers` 활성 턴은 성공한 공개 후보 조회만 허용하는 보호 섹션으로
 * 교체된다. 일반 장소 검색과 예약 금지는 이 활성 여부와 별도로 검사한다.
 *
 * 금지(가짜 업체 금지·예약 약속 금지·판정 금지)는 그대로다. 이 파일은 그 금지가
 * 살아 있는지와, 능력을 부정하는 문장마다 주어가 웨딩 업체인지를 함께 잰다.
 */
import { describe, expect, it } from "vitest";

import { buildAmoraSystemPrompt } from "@/lib/ai/amoraPromptComposer";
import { isMutatingTool } from "@/lib/ai/mutationTools";
import { BETA_SAFE_TOOLS } from "@/lib/ai/tools";

const HEADING = "## 업체 추천·예약은 지금 제공하지 않습니다";
const DISCOVERY_HEADING = "## 공개 참여자 후보와 예약의 경계";

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
  { label: "운영 조회 도구셋(공개 후보·장소 검색 포함)", enabledToolNames: PRODUCTION_ENABLED_TOOL_NAMES },
  { label: "공개 후보 탐색 제외", enabledToolNames: PRODUCTION_ENABLED_TOOL_NAMES.filter((name) => name !== "discover_providers") },
  { label: "공개 후보 탐색만", enabledToolNames: ["discover_providers"] },
  { label: "공개 후보와 장소 검색", enabledToolNames: ["discover_providers", "search_nearby_places"] },
  { label: "장소 검색만", enabledToolNames: ["search_nearby_places"] },
  { label: "도구 0개", enabledToolNames: [] },
];

function promptFor(enabledToolNames: string[]): string {
  return buildAmoraSystemPrompt(CONTEXT as never, {
    enabledToolNames,
    requestKind: "chat",
    persistenceMode: "durable",
    maxChars: 48_000,
  } as never) as string;
}

function sectionFor(enabledToolNames: string[]): string {
  const prompt = promptFor(enabledToolNames);
  const heading = enabledToolNames.includes("discover_providers") ? DISCOVERY_HEADING : HEADING;
  const start = prompt.indexOf(heading);
  expect(start, "보호 섹션이 합성 결과에서 사라졌다").toBeGreaterThan(-1);
  const end = prompt.indexOf("\n## ", start + heading.length);
  return end === -1 ? prompt.slice(start) : prompt.slice(start, end);
}

describe("못 한다는 고지의 주어가 웨딩 업체로 한정된다", () => {
  it("공개 후보 탐색 여부와 무관하게 일반 장소 검색을 예약과 구분한다", () => {
    for (const { label, enabledToolNames } of VARIANTS) {
      if (!enabledToolNames.includes("discover_providers")) {
        expect(sectionFor(enabledToolNames), `${label}: 장소 검색과의 경계가 없다`)
          .toContain("일반 장소 검색은 여기 해당하지 않습니다");
      }
      if (enabledToolNames.includes("search_nearby_places")) {
        const prompt = promptFor(enabledToolNames);
        expect(prompt, label).toContain("search_nearby_places");
        expect(prompt, label).toContain("공개된 장소 정보를 보여주는 것이지 예약이 아닙니다");
        expect(prompt, label).toContain("자리를 잡아 주거나 확정해 주지 않습니다");
      }
    }
  });

  it("비활성 턴의 능력 부정은 웨딩 업체로 한정하고 활성 턴은 성공 결과만 허용한다", () => {
    // 낱말 하나를 세지 않고 **문장 단위**로 묻는다. 주어 없이 "업체를 찾는 도구가
    // 없습니다" 로 되돌아가면 여기서 빨간불이 난다.
    const denialMarkers = ["를 찾거나", "추천이나 예약을 요청받으면", "예약해 드릴게요"];
    for (const { label, enabledToolNames } of VARIANTS) {
      const section = sectionFor(enabledToolNames);
      if (enabledToolNames.includes("discover_providers")) {
        expect(promptFor(enabledToolNames), label).not.toContain(HEADING);
        expect(section, label).toContain("공개 참여자 탐색 도구의 성공 결과가 있을 때만");
        expect(section, label).toContain("개인·팀·업체와 공간 서비스를 후보로 소개");
        expect(section, label).toContain("등록 승인과 서비스별 추천 심사는 다르며");
        expect(section, label).toContain("필수 조건이 미확인이면 맞는다고 단정하지 말고");
        continue;
      }
      expect(promptFor(enabledToolNames), label).not.toContain(DISCOVERY_HEADING);
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
    // 후보 탐색이 켜져도 지어낸 업체·확인하지 않은 가격·예약 약속은 허용하지 않는다.
    for (const { label, enabledToolNames } of VARIANTS) {
      const section = sectionFor(enabledToolNames);
      const rules = enabledToolNames.includes("discover_providers") ? [
        "도구가 돌려주지 않은 이름·가격을 만들지 마세요",
        "예약 생성·확정·취소와 문의 전송은 제공하지 않습니다",
        "'예약해 드릴게요'라고 약속하지 마세요",
        "조회에 실패하면 이름을 추측하지 말고",
        "점수·등급·보장으로 판정하지 마세요",
      ] : [
        "업체명을 먼저 꺼내지 마세요",
        "찾아볼게요",
        "예약해 드릴게요",
        "절대 가짜 업체 만들지 마세요",
        "점수, 등급, \"최고\", \"보장\"으로 판정하지 마세요",
      ];
      for (const rule of rules) {
        expect(section, `${label}: "${rule}" 가 사라졌다`).toContain(rule);
      }
    }
  });
});
