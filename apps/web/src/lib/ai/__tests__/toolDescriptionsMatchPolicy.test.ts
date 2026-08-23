import { describe, expect, it } from "vitest";

import { WEDDING_TOOLS } from "@/lib/ai/tools";

/**
 * 도구 설명문은 모델에게 주는 계약이다. 규칙이 바뀌었는데 설명문이 남으면
 * 모델은 없는 규칙을 따르려 한다 — 오늘 하루 이 부류로 세 번 사고가 났다.
 *
 * 2026-08-23 파운더 결정으로 두 사람 승인이 없어졌는데
 * `cancel_schedule_event`·`restore_schedule_event`·`update_schedule_event` 의
 * 설명문이 "두 사람의 확인이 필요합니다" 라고 계속 말하고 있었다.
 *
 * 같은 설명문이 "먼저 get_schedule_events로 event_id를 확인하세요" 라고도
 * 시켰는데, 그 조회 도구는 그 턴에 주어지지 않는다. 그래서 아모라는 표식을
 * 내는 대신 "취소를 제안할게요" 라고만 말하고 끝냈다.
 */
describe("도구 설명문이 지금 규칙과 같다", () => {
  const descriptions = WEDDING_TOOLS.map((tool) => ({
    name: tool.name,
    text: tool.description ?? "",
  }));

  it("두 사람 승인을 요구하는 설명문이 남아 있지 않다", () => {
    const offenders = descriptions
      .filter((tool) => /두\s*사람의?\s*확인/.test(tool.text))
      .map((tool) => tool.name);
    expect(offenders).toEqual([]);
  });

  it("일정 도구가 event_id의 출처를 알려준다", () => {
    for (const name of [
      "cancel_schedule_event",
      "restore_schedule_event",
    ]) {
      const tool = descriptions.find((entry) => entry.name === name);
      expect(tool, `${name} 도구가 없습니다`).toBeTruthy();
      expect(tool!.text).toContain("등록된 일정");
      expect(tool!.text).not.toContain("먼저 get_schedule_events");
    }
  });
});
