import { describe, expect, it } from "vitest";

import {
  CATEGORY_CHECKLISTS,
  CHECKLIST_MAP,
  RETIRED_CHECKLIST_ITEM_IDS,
} from "@hanbang/shared/constants";
import { mergePlanningChecklist } from "@hanbang/shared/utils";

/**
 * 템플릿에서 내린 항목이 **이미 저장한 커플에게도** 사라지는가.
 *
 * 항목을 배열에서 지우는 것만으로는 화면에서 안 사라진다. 이 제품의 체크 기록은
 * `{id, label, done}` 배열째로 `couples.progress` 에 들어 있고, `mergePlanningChecklist`
 * 는 템플릿에 없는 저장 항목을 **잃지 않으려고 뒤에 다시 붙인다.** 그 장치가 없으면
 * 사용자가 직접 만든 항목이 배포마다 지워지므로 그 동작 자체는 옳다.
 *
 * 그래서 한 번이라도 그 분야를 열어 본 커플에게는 내린 항목이 목록 맨 아래에 그대로
 * 남는다 — 새로 가입한 사람에게만 사라지고, 쓰던 사람에게는 안 사라진다. 가장 나쁜
 * 모양이다. 잠금 변경이 내린 두 항목이 정확히 그 경로에 있었다.
 *
 * `RETIRED_CHECKLIST_ITEM_IDS` 가 그 예외를 적어 두는 자리다. 여기서는 그 목록이
 * 실제로 무는지, 그리고 **다른 항목의 완료 기록까지 지우지는 않는지**를 본다.
 */
describe("내린 체크리스트 항목", () => {
  const meeting = CHECKLIST_MAP.meeting;

  it("내린 목록이 비어 있지 않다", () => {
    // 비면 아래 검사들이 아무것도 확인하지 않는다. 먼저 표본이 있는지 본다.
    expect([...RETIRED_CHECKLIST_ITEM_IDS]).toEqual(["meeting_05", "meeting_06"]);
  });

  it("템플릿에 내린 항목이 남아 있지 않다", () => {
    const stillListed = CATEGORY_CHECKLISTS.flatMap((category) =>
      category.items
        .filter((item) => RETIRED_CHECKLIST_ITEM_IDS.has(item.id))
        .map((item) => `${category.key}/${item.id}`),
    );
    expect(stillListed, "내렸다고 적어 두고 템플릿에는 그대로 뒀다").toEqual([]);
  });

  it("이미 저장한 커플의 기록에서도 되살아나지 않는다", () => {
    // 항목이 일곱이던 시절에 이 분야를 다 체크한 커플의 저장값.
    const saved = [
      { id: "meeting_01", label: "양쪽 부모님 첫 만남 날짜 조율", done: true },
      { id: "meeting_02", label: "만날 장소 정하고 예약", done: true },
      { id: "meeting_07", label: "식사비를 누가 낼지 미리 정하기", done: true },
      { id: "meeting_03", label: "참석자와 옷차림 확인", done: false },
      { id: "meeting_04", label: "서로 드릴 선물이 필요한지 합의", done: false },
      { id: "meeting_05", label: "결혼식 날짜와 전체 예산 이야기", done: true },
      { id: "meeting_06", label: "가전·가구와 두 가족에게 드릴 선물의 비용 분담 이야기", done: true },
    ];

    const merged = mergePlanningChecklist(meeting.items, saved);

    expect(merged.map((item) => item.id)).toEqual(
      meeting.items.map((item) => item.id),
    );
    // 남은 항목의 체크는 그대로다. 내린 항목을 지우자고 다른 기록까지 초기화하면
    // 사용자는 자기가 한 일을 잃는다.
    expect(
      merged.filter((item) => item.done).map((item) => item.id),
    ).toEqual(["meeting_01", "meeting_02", "meeting_07"]);
  });

  it("우리가 모르는 저장 항목은 계속 보존한다", () => {
    // 내린 항목만 버린다. 이 구분이 없으면 예전 판이나 직접 추가한 항목이 함께 날아간다.
    const merged = mergePlanningChecklist(meeting.items, [
      { id: "meeting_05", label: "결혼식 날짜와 전체 예산 이야기", done: true },
      { id: "meeting_99", label: "우리끼리 추가한 항목", done: true },
    ]);

    expect(merged.map((item) => item.id)).toContain("meeting_99");
    expect(merged.map((item) => item.id)).not.toContain("meeting_05");
  });
});
