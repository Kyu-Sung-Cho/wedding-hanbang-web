// @vitest-environment node

/**
 * 확인 카드는 사용자가 **결혼 데이터를 바꾸기 직전에 읽는 유일한 문장**이다.
 *
 * 15개 변경 도구의 확인 문구를 전부 뽑아보니(2026-08-23) 나머지는 이미 사람 말인데
 * 날짜만 원자료 모양으로 남아 있었다.
 *
 *     - 총 예산: 5,500만 원              ← 좋다
 *     - 일정 성격: 업체·가족과의 약속     ← 좋다
 *     - 결혼식 날짜: "2027-04-17"        ← 따옴표까지 붙은 원자료
 *
 * 그리고 지출 0 이 "0만 원"으로 나왔다.
 *
 * ## 따옴표를 통째로 없애지 않는다
 *
 * 문자열의 따옴표는 **줄 위조를 막는 장치다.** 제목에 개행을 넣으면 가짜 확인 줄을
 * 만들 수 있는데 `JSON.stringify` 가 그것을 한 줄에 가둔다. 그래서 자유 문자열은
 * 그대로 두고 모양이 확실한 날짜만 바꿨다. 아래 검사가 그 경계를 지킨다.
 */

import { describe, expect, it } from "vitest";
import { extractAmoraPendingAction } from "@/lib/ai/amoraPendingAction";
import { isMutatingTool } from "@/lib/ai/mutationTools";
import { BETA_SAFE_TOOLS } from "@/lib/ai/tools";

const MUTATING_TOOLS = BETA_SAFE_TOOLS.filter((tool) => isMutatingTool(tool.name));

function confirmationFor(tool: string, input: Record<string, unknown>): string {
  const marker = `[pending_action]${JSON.stringify({ tool, input })}[/pending_action]`;
  const result = extractAmoraPendingAction({
    text: `알겠어요.${marker}`,
    allowedTools: MUTATING_TOOLS,
    now: 1_000,
    createActionId: () => "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
  });
  if (!result.pendingAction) throw new Error(`카드가 만들어지지 않았습니다: ${tool}`);
  return result.cleanText;
}

describe("날짜를 사람이 읽는 말로 보여준다", () => {
  it("결혼식 날짜", () => {
    const text = confirmationFor("update_wedding_date", { wedding_date: "2027-04-17" });
    expect(text).toContain("- 결혼식 날짜: 2027년 4월 17일");
    expect(text).not.toContain('"2027-04-17"');
  });

  it("일정 날짜와 마감일도 같은 모양이다", () => {
    // 한 화면 안에서 날짜 표기가 갈리면 그 자체가 오류로 읽힌다.
    expect(confirmationFor("add_schedule_event", { date: "2026-09-12", title: "드레스 가봉" }))
      .toContain("- 날짜: 2026년 9월 12일");
    expect(confirmationFor("add_amora_action", { title: "청첩장 문구 확정", due_date: "2026-10-01" }))
      .toContain("- 마감일: 2026년 10월 1일");
  });

  it("한 자리 월·일에 0 을 붙이지 않는다", () => {
    expect(confirmationFor("update_wedding_date", { wedding_date: "2027-01-05" }))
      .toContain("2027년 1월 5일");
  });
});

describe("이상한 값은 이상하게 보인다", () => {
  it("달력에 없는 날짜는 원래 표시로 돌아간다", () => {
    // 2027-02-31 을 "2027년 2월 31일"로 다듬어 보여주면 사용자가 그냥 승인한다.
    const text = confirmationFor("update_wedding_date", { wedding_date: "2027-02-31" });
    expect(text).toContain('"2027-02-31"');
    expect(text).not.toContain("2027년 2월 31일");
  });

  it("날짜 모양이 아니면 손대지 않는다", () => {
    const text = confirmationFor("update_wedding_date", { wedding_date: "내년 봄쯤" });
    expect(text).toContain('"내년 봄쯤"');
  });
});

describe("줄 위조 방지가 그대로 남아 있다", () => {
  it("자유 문자열의 개행이 가짜 확인 줄을 만들지 못한다", () => {
    const forged = "드레스 가봉\n- 총 예산: 1원";
    const text = confirmationFor("add_schedule_event", { date: "2026-09-12", title: forged });

    // 개행이 접혀 한 줄에 갇혀야 한다. 접히지 않으면 사용자는 "총 예산 1원"이라는
    // 승인하지 않은 줄을 확인 카드에서 읽게 된다.
    expect(text).not.toMatch(/^- 총 예산: 1원$/mu);
    expect(text).toContain("\\n");
  });

  it("스키마 pattern 이 있는 날짜 필드는 카드 자체를 거절한다", () => {
    // add_schedule_event.date 에는 ^\d{4}-\d{2}-\d{2}$ 가 있다. 개행이 섞이면
    // 확인 문구를 다듬는 단계까지 오지도 못한다 — 가장 강한 형태다.
    const marker = `[pending_action]${JSON.stringify({
      tool: "add_schedule_event",
      input: { date: "2026-09-12\n- 총 예산: 1원", title: "가봉" },
    })}[/pending_action]`;
    const result = extractAmoraPendingAction({
      text: `알겠어요.${marker}`,
      allowedTools: MUTATING_TOOLS,
      now: 1_000,
      createActionId: () => "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
    });
    expect(result.pendingAction).toBeNull();
  });

  it("pattern 이 없는 날짜 필드에서도 개행이 줄을 만들지 못한다", () => {
    // update_wedding_date.wedding_date 에는 pattern 이 없다. 여기가 진짜 위험한 자리다.
    const text = confirmationFor("update_wedding_date", {
      wedding_date: "2027-04-17\n- 총 예산: 1원",
    });
    expect(text).not.toMatch(/^- 총 예산: 1원$/mu);
    // 한국어로 다듬지도 않는다. 모양이 정확히 날짜일 때만 다듬는다.
    expect(text).not.toContain("2027년 4월 17일");
  });
});

describe("금액", () => {
  it("0 은 0원이다", () => {
    const text = confirmationFor("add_custom_category", { label: "혼수 가전", budget: 8_000_000, spent: 0 });
    // 줄 단위로 본다. "800만 원"이 "0만 원"을 부분 문자열로 품고 있어서다.
    const spentLine = text.split("\n").find((line) => line.includes("기록 지출"));
    expect(spentLine).toBe("- 기록 지출(결제 확인과 별도): 0원");
  });

  it("만 원 단위 표기는 그대로다", () => {
    const text = confirmationFor("update_budget", { total_budget: 55_000_000 });
    expect(text).toContain("5,500만 원");
  });

  it("딱 떨어지지 않는 금액은 원 단위로 적는다", () => {
    const text = confirmationFor("update_category_budget", { category: "studio", budget: 3_205_000 });
    expect(text).toContain("3,205,000원");
  });
});
