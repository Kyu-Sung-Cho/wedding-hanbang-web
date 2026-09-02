import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { CATEGORY_CHECKLISTS } from "@/constants/checklists";
import { buildAmoraLifecyclePlan } from "@/lib/amora/lifecycle";
import { weddingLinkProps, weddingPath } from "@/lib/weddingPaths";

/**
 * 「체크」라고 적힌 버튼이 체크리스트로 가는지 본다.
 *
 * ## 무엇이 틀려 있었나
 *
 * 라운지의 「놓치기 쉬운 항목」은 체크리스트 분야를 진행률(`3/9 체크`)과 함께
 * 보여주는 구역인데, 머리의 「전체 체크」도 각 분야 줄도 전부 **일정 화면**을
 * 열었다. 항목을 체크하러 누른 사람이 달력을 만난다. 주차 카드의 「곧 확인할
 * 분야」와 아모라 가드레일도 같았고, 가드레일은 버튼에 「체크리스트」라고
 * 적어 두고도 일정으로 보냈다.
 *
 * ## 왜 소스를 읽어서 검사하는가
 *
 * 목적지는 JSX 안의 `weddingLinkProps(...)` 인자라서 렌더링 없이는 값으로 꺼낼
 * 수 없고, 이 페이지 전체를 렌더링하려면 스토어·네트워크·튜토리얼까지 세워야
 * 한다. 여기서 지키려는 것은 그리기가 아니라 **한 줄의 목적지**이므로 그 줄을
 * 직접 본다. 대신 「검사가 실제로 무언가를 보고 있는지」를 먼저 확인한다.
 */

function read(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

const LOUNGE = read("src/app/(app)/lounge/page.tsx");
const WEEKLY_CARD = read("src/components/app/WeeklyCard.tsx");

/** 「놓치기 쉬운 항목」 구역 — 머리의 전체 보기 링크와 분야 줄이 여기 있다. */
function loungeToolsSection(): string {
  const start = LOUNGE.indexOf('data-tutorial-target="lounge-tools"');
  expect(start, "「놓치기 쉬운 항목」 구역을 못 찾았다").toBeGreaterThan(-1);
  return LOUNGE.slice(start, LOUNGE.indexOf("</section>", start));
}

function categoryRowSource(): string {
  const start = LOUNGE.indexOf("function CategoryRow(");
  expect(start, "CategoryRow 를 못 찾았다").toBeGreaterThan(-1);
  return LOUNGE.slice(start, LOUNGE.indexOf("\nfunction ", start + 1));
}

describe("체크리스트 CTA 는 체크리스트로 간다", () => {
  it("「전체 체크」가 일정이 아니라 체크리스트를 연다", () => {
    const section = loungeToolsSection();
    expect(section).toContain("전체 체크");
    expect(section).toContain('weddingLinkProps("/checklist")');
  });

  it("분야 줄이 그 분야의 체크리스트를 연다", () => {
    const row = categoryRowSource();
    // 진행률을 보여주는 줄이라는 것을 함께 못박는다. 이 줄이 사라지면 위 검사가
    // 엉뚱한 곳을 보고 있다는 뜻이다.
    expect(row).toContain("체크");
    expect(row).toContain("/checklist?category=");
    expect(row).not.toContain('weddingLinkProps("/schedule")');
  });

  it("주차 카드의 「곧 확인할 분야」도 체크리스트를 연다", () => {
    // 파일 머리 주석에도 같은 말이 있으므로 **그리는 자리**를 짚는다.
    const start = WEEKLY_CARD.indexOf("data.imminent.map(");
    expect(start, "「곧 확인할 분야」를 그리는 자리를 못 찾았다").toBeGreaterThan(-1);
    const block = WEEKLY_CARD.slice(start, WEEKLY_CARD.indexOf("</ul>", start));
    expect(block).toContain("/checklist?category=");
    expect(block).not.toContain('weddingLinkProps("/schedule")');
  });

  it("「체크리스트」라고 적힌 아모라 가드레일이 체크리스트로 간다", () => {
    const plan = buildAmoraLifecyclePlan({
      // 분야 가드레일이 실제로 만들어지는 구간. 예식이 가까워야 기본 확인
      // 시점을 지난 분야가 생긴다.
      weddingDate: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
      totalBudget: 50_000_000,
      progress: {},
    });

    const checklistGuardrails = plan.guardrails.filter((item) => item.cta === "체크리스트");
    expect(
      checklistGuardrails.length,
      "「체크리스트」 가드레일이 하나도 안 나왔다 — 검사가 무의미해진다",
    ).toBeGreaterThan(0);

    for (const guardrail of checklistGuardrails) {
      expect(guardrail.href).toContain("/checklist");
      expect(guardrail.href).not.toContain("/schedule");
    }
  });

  /**
   * 목적지 문자열이 맞아도 **실제로 열리는 주소**가 틀리면 소용이 없다. 분야를
   * 붙인 주소가 어떤 링크 속성으로 풀리는지 값으로 확인한다.
   */
  it("분야를 붙인 주소가 실제 링크 속성으로 바르게 풀린다", () => {
    const props = weddingLinkProps("/checklist?category=venue");
    expect(props.href).toBe("/checklist?category=venue");
    expect(props.as).toBe("/wedding/checklist?category=venue");
    expect(weddingPath("/checklist?category=venue")).toBe("/wedding/checklist?category=venue");
  });

  /**
   * 이름에 물음표·앰퍼샌드가 들어갈 수 있는 분야는 없지만, 붙이는 쪽이
   * `encodeURIComponent` 를 쓰는지는 계약이다 — 안 쓰면 나중에 키가 바뀔 때
   * 조용히 깨진다.
   */
  it("분야 키를 그대로 이어붙이지 않는다", () => {
    const row = categoryRowSource();
    expect(row).toContain("encodeURIComponent(");
  });

  /**
   * 체크리스트 화면이 그 질의를 실제로 읽는가. 목적지만 맞고 화면이 안 읽으면
   * 사용자는 도착만 하고 누른 분야는 안 열린다.
   */
  it("체크리스트 화면이 category 질의를 읽는다", () => {
    const content = read("src/components/app/checklist/ChecklistContent.tsx");
    expect(content).toContain('searchParams.get("category")');
  });

  it("분야 키가 체크리스트 화면이 아는 값이다", () => {
    // 목적지가 체크리스트여도 `?category=` 값이 화면의 분야 키와 다르면
    // 도착해서 아무것도 안 열린다.
    const plan = buildAmoraLifecyclePlan({
      weddingDate: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
      totalBudget: 50_000_000,
      progress: {},
    });
    const knownKeys = new Set(CATEGORY_CHECKLISTS.map((category) => category.key));

    for (const guardrail of plan.guardrails) {
      const category = /\/checklist\?category=([^&"]+)/.exec(guardrail.href)?.[1];
      if (!category) continue;
      expect(knownKeys.has(decodeURIComponent(category))).toBe(true);
    }
  });
});

/**
 * 라운지 아래쪽 세 칸(커뮤니티 → 아모라 → 라운지에 남김)의 마지막 칸도 체크
 * 아이콘(`ListChecks`)을 달고 일정 화면을 열고 있었다. 아이콘·문구·목적지가
 * 같은 것을 가리키게 한다.
 */
describe("라운지 아래 세 칸의 마지막은 남기는 곳으로 간다", () => {
  it("「라운지에 남김」이 체크리스트를 연다", () => {
    const start = LOUNGE.indexOf('title: "라운지에 남김"');
    expect(start, "「라운지에 남김」 칸을 못 찾았다").toBeGreaterThan(-1);
    const block = LOUNGE.slice(start, start + 300);
    expect(block).toContain('weddingPath("/checklist")');
  });
});

/**
 * 반대 방향도 본다.
 *
 * 「체크로 가야 할 것을 일정으로 보내지 않는가」만 보면, 지나쳐서 **일정으로 가야
 * 할 것까지 체크리스트로 돌리는** 반대 실수를 못 잡는다. 라운지에 남아 있는
 * 일정 링크가 실제로 일정 성격인지 확인한다.
 */
describe("일정으로 가야 할 것은 그대로 일정으로 간다", () => {
  it("남아 있는 일정 링크가 모두 일정 성격이다", () => {
    // 다가오는 일정 우선순위 카드와 「다가오는 예약」 패널의 줄.
    const eventPriority = LOUNGE.slice(
      LOUNGE.indexOf('eyebrow: "다가오는 일정"'),
      LOUNGE.indexOf('tone: "steady" as const'),
    );
    expect(eventPriority).toContain('weddingPath("/schedule")');
    expect(eventPriority).toContain('cta: "일정 보기"');

    const panel = LOUNGE.slice(LOUNGE.indexOf("function UpcomingEventsPanel("));
    expect(panel).toContain('weddingLinkProps("/schedule")');
  });

  it("식 후 남은 일 정리와 준비 일정 바로가기는 일정으로 간다", () => {
    const plan = buildAmoraLifecyclePlan({
      // 예식이 지난 커플이어야 식 후 가드레일이 나온다.
      weddingDate: new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10),
      totalBudget: 50_000_000,
      progress: {},
    });

    const aftercare = plan.guardrails.find((item) => item.id === "aftercare_tasks");
    expect(aftercare, "식 후 가드레일이 안 나왔다 — 검사가 무의미해진다").toBeTruthy();
    expect(aftercare?.href).toContain("/schedule");
    expect(aftercare?.cta).toBe("남은 일 정리");

    const scheduleShortcut = plan.quickActions.find((item) => item.id === "schedule");
    expect(scheduleShortcut?.href).toContain("/schedule");
    expect(scheduleShortcut?.label).toBe("준비 일정");
  });
});
