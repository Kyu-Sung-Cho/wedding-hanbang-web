import { describe, expect, it } from "vitest";

import { buildAmoraPendingActionPrompt } from "../amoraPendingAction";
import { resolveAmoraWeddingContext } from "../amoraWeddingContext";
import { getWeddingPlannerSystemPrompt } from "../prompts";

// 2026-08-23 라이브에서 아모라가 "항목 ID를 알 수 없다"며 사용자에게 화면에서
// ID를 읽어오라고 되물었다. 사용자는 그런 걸 모른다. 프롬프트가 id·label 을
// 실어야 `toggle_checklist_item` 이 쓸 수 있다.
const PROGRESS = {
  invitation: {
    checklist: [
      { id: "invitation_01", label: "종이·모바일 초대장 중 필요한 형태 정하기", done: true },
      { id: "invitation_02", label: "초대장 디자인 초안 선택", done: false },
      { id: "invitation_03", label: "문구 및 정보 작성", done: false },
    ],
  },
};

const SCHEDULE_EVENTS = [
  { id: "evt_m1a2b3_zx90", date: "2026-09-25", title: "양가 상견례", categoryKey: "general" },
];

function build(progress: unknown) {
  return getWeddingPlannerSystemPrompt({
    weddingDate: "2027-05-15",
    budget: 80_000_000,
    venue: null,
    progress: progress as never,
    preparationStatus: null,
    brideName: "베타신부",
    groomName: "베타신랑",
    bookings: [],
    scheduleEvents: SCHEDULE_EVENTS,
    chatSummaries: [],
    pastConflicts: [],
    pastDecisions: [],
  } as never);
}

describe("체크리스트 항목 ID가 프롬프트에 실린다", () => {
  it("id=label 형태로 실린다", () => {
    const prompt = build(PROGRESS);
    expect(prompt).toContain("invitation_02");
    expect(prompt).toContain("초대장 디자인 초안 선택");
  });

  it("완료 표시가 붙어 되돌릴 항목도 구분된다", () => {
    const prompt = build(PROGRESS);
    expect(prompt).toContain("✅invitation_01");
    expect(prompt).toContain("⬜invitation_02");
  });
});

describe("일정 id가 프롬프트에 실린다", () => {
  it("취소·변경 도구가 쓸 event_id가 보인다", () => {
    const prompt = build(PROGRESS);
    expect(prompt).toContain("evt_m1a2b3_zx90");
    expect(prompt).toContain("양가 상견례");
  });
});

describe("후속 확인 계약이 id의 출처를 알려준다", () => {
  // 계약문이 "식별자는 문맥에 없다"고 말하면, 문맥에 실어도 아모라는 되묻는다.
  // 2026-08-23 라이브에서 정확히 그렇게 됐다.
  const contract = buildAmoraPendingActionPrompt([]);

  it("일정과 체크리스트 두 출처를 모두 짚는다", () => {
    expect(contract).toContain("등록된 일정");
    expect(contract).toContain("evt_");
    expect(contract).toContain("invitation_02");
  });

  it("문맥에 있으면 되묻지 말라고 말한다", () => {
    expect(contract).toContain("되묻지 말고");
  });

  it("문맥에 없으면 지어내지 말라는 가드는 남아 있다", () => {
    expect(contract).toContain("지어내지 말고");
  });
});

describe("일정 id가 정규화에서 살아남는다", () => {
  // 프롬프트 렌더링만 테스트하면 이 구간이 통째로 빈다 — 실제로 처음 쓴 테스트가
  // 그랬고, 정규화에서 id 를 도로 빼는 변형이 초록불을 통과했다.
  const resolve = (events: unknown) =>
    resolveAmoraWeddingContext({
      canonicalJourney: { progress: { __events: events } },
      clientContext: undefined,
      allowClientContext: false,
    } as never);

  it("서버 여정의 event id가 문맥까지 온다", () => {
    const resolved = resolve([
      { id: "evt_m1a2b3_zx90", date: "2026-09-25", title: "양가 상견례", status: "planned" },
    ]);
    expect(resolved.scheduleEvents[0]?.id).toBe("evt_m1a2b3_zx90");
  });

  it("id가 없는 옛 일정도 버리지 않는다", () => {
    const resolved = resolve([{ date: "2026-09-25", title: "양가 상견례", status: "planned" }]);
    expect(resolved.scheduleEvents).toHaveLength(1);
    expect(resolved.scheduleEvents[0]?.id).toBeUndefined();
  });
});
