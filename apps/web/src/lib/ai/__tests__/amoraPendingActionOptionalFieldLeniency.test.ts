/**
 * **선택 필드 하나가 틀렸다고 카드를 통째로 버리지 않는다.**
 *
 * 2026-09-04 스테이징 실측: 할 일 카드 요청 3턴 중 1턴이 `pending_action_dropped`
 * 였다. 같은 날 검증기에 후보 입력을 넣어 재현해 보니, 필수값(`title`)은 멀쩡한데
 * 선택 필드 하나 때문에 표식 전체가 사라지는 입력이 넷이었다(한글 카테고리 라벨,
 * 지어낸 중요도, 지어낸 출처, enum 밖 경로). 다섯째는 더 나빴다 — 한국어 마감일은
 * 검증을 통과해 카드까지 나가고, 사용자가 확인을 누른 뒤에야 실행기가
 * `invalid_action_due_date` 로 거절했다.
 *
 * 입력은 **운영 도구 정의**(BETA_SAFE_TOOLS)에서 유도한다. 손으로 만든 스키마로
 * 재면 운영이 절대 만들지 않는 모양을 검사하게 된다(이 저장소가 두 번 당했다).
 */
import { describe, expect, it } from "vitest";
import {
  extractAmoraPendingAction,
  resolveAmoraPendingAction,
} from "@/lib/ai/amoraPendingAction";
import { BETA_SAFE_TOOLS } from "@/lib/ai/tools";
import { isMutatingTool } from "@/lib/ai/mutationTools";

const PROPOSABLE_TOOLS = BETA_SAFE_TOOLS.filter((tool) => isMutatingTool(tool.name));
const ACTION_ID = "11111111-1111-4111-8111-111111111111";
/** KST 2026-09-04 12:00. 연도 없는 날짜의 기준이 되는 "오늘". */
const NOW = Date.UTC(2026, 8, 4, 3, 0, 0);

function extract(tool: string, input: Record<string, unknown>, now = NOW) {
  const marker = `[pending_action]${JSON.stringify({ tool, input })}[/pending_action]`;
  return extractAmoraPendingAction({
    text: `알겠어요.\n${marker}`,
    allowedTools: PROPOSABLE_TOOLS,
    now,
    createActionId: () => ACTION_ID,
  });
}

describe("행동 카드의 선택 필드는 보정하고 필수 필드는 그대로 요구한다", () => {
  it("목록 밖 카테고리는 '일반'으로 보정하고 카드는 나간다", () => {
    // 실측에서 모델이 실제로 낸 모양이다 — 한글 라벨을 넣었다.
    const result = extract("add_amora_action", {
      title: "혼주 한복 예약",
      due_date: "2026-09-25",
      category_key: "한복",
    });

    expect(result.pendingAction?.input).toEqual({
      title: "혼주 한복 예약",
      due_date: "2026-09-25",
      category_key: "general",
    });
    // 보정한 값은 사용자가 누르기 전에 카드에서 읽는다. 그래서 안전하다.
    expect(result.cleanText).toBe([
      "다음 변경을 적용할까요?",
      "- 변경: 아모라 행동 카드 추가",
      "- 제목: \"혼주 한복 예약\"",
      "- 마감일: 2026년 9월 25일",
      "- 관련 카테고리: 일반",
    ].join("\n"));
  });

  it("목록 밖 중요도는 '보통'으로 보정한다", () => {
    const result = extract("add_amora_action", {
      title: "혼주 한복 예약",
      priority: "긴급",
    });

    expect(result.pendingAction?.input).toEqual({
      title: "혼주 한복 예약",
      priority: "medium",
    });
    expect(result.cleanText).toContain("- 중요도: 보통");
  });

  it("목록 밖 연결 경로와 출처는 뺀다", () => {
    // `/wedding/actions` 는 라이브에서 실제로 나온 없는 경로다. 기본값을 지어내지
    // 않고 빼면 서버가 `defaultActionHref` 로 알맞은 화면을 고른다.
    const result = extract("add_amora_action", {
      title: "혼주 한복 예약",
      href: "/wedding/actions",
      source: "대화",
    });

    expect(result.pendingAction?.input).toEqual({ title: "혼주 한복 예약" });
    expect(result.cleanText).not.toContain("연결 화면");
    expect(result.cleanText).not.toContain("저장 출처");
  });

  it("연도 없는 마감일은 오늘 이후 가장 가까운 날짜로 보정한다", () => {
    const result = extract("add_amora_action", {
      title: "혼주 한복 예약",
      due_date: "9월 25일",
    });

    expect(result.pendingAction?.input.due_date).toBe("2026-09-25");
    expect(result.cleanText).toContain("- 마감일: 2026년 9월 25일");
  });

  it("올해가 이미 지난 날짜면 내년으로 읽는다", () => {
    const result = extract("add_amora_action", {
      title: "예식장 잔금 이체",
      due_date: "1월 5일",
    });

    expect(result.pendingAction?.input.due_date).toBe("2027-01-05");
  });

  it("KST 새벽에도 오늘 날짜를 지난 날짜로 읽지 않는다", () => {
    // UTC 로는 아직 9월 24일, KST 로는 9월 25일 01:30. `toISOString` 으로 오늘을
    // 구하면 "9월 25일" 이 내년으로 밀린다.
    const result = extract(
      "add_amora_action",
      { title: "혼주 한복 예약", due_date: "9월 25일" },
      Date.UTC(2026, 8, 24, 16, 30, 0),
    );

    expect(result.pendingAction?.input.due_date).toBe("2026-09-25");
  });

  it("되돌릴 수 없는 마감일은 빼고 카드는 그대로 낸다", () => {
    const vague = extract("add_amora_action", {
      title: "부케 업체 알아보기",
      due_date: "언젠가",
    });
    expect(vague.pendingAction?.input).toEqual({ title: "부케 업체 알아보기" });

    // 달력에 없는 날짜도 마찬가지다. 형식만 맞다고 통과시키면 실행기가 거절한다.
    const impossible = extract("add_amora_action", {
      title: "부케 업체 알아보기",
      due_date: "2026-02-31",
    });
    expect(impossible.pendingAction?.input).toEqual({ title: "부케 업체 알아보기" });
    expect(impossible.cleanText).not.toContain("마감일");
  });

  it("필수 필드가 없으면 지금처럼 버린다", () => {
    const result = extract("add_amora_action", {
      due_date: "2026-09-25",
      category_key: "hanbok",
    });

    expect(result.pendingAction).toBeNull();
    expect(result.hadPendingActionTag).toBe(true);
  });

  it("선언되지 않은 키는 그 키만 버리고 카드는 낸다", () => {
    // 2026-09-04 정정. 예전에는 모르는 키 하나에 표식이 통째로 버려졌다
    // (스테이징 X7 이 그 모양이다 — `pending_action_dropped: true`).
    //
    // 걱정했던 것은 "사용자가 확인한 적 없는 값이 실행 경로로 들어가는 것"인데,
    // 키를 버리면 그 걱정은 그대로 사라진다. 실행기는 남은 필드만 보고, 확인 카드는
    // 원래도 **선언된 필드만** 적었다.
    const result = extract("add_amora_action", {
      title: "혼주 한복 예약",
      due_date: "2026-09-25",
      location: "종로 한복거리",
    });

    expect(result.pendingAction?.input).toEqual({
      title: "혼주 한복 예약",
      due_date: "2026-09-25",
    });
    // 버린 값은 카드 본문에도 없다 — 카드가 실제보다 많이 약속하지 않는다.
    expect(result.cleanText).not.toContain("종로");
  });

  /**
   * **흔한 다른 이름은 먼저 되돌린다.** (2026-09-04)
   *
   * 버리기 전에 이름부터 맞춰 본다. 그러지 않으면 뜻이 분명한 값이 그냥 사라진다 —
   * `deadline: "2026-10-02"` 은 마감일이지 알 수 없는 값이 아니다.
   */
  const aliasCases: Array<[string, Record<string, unknown>, Record<string, unknown>]> = [
    [
      "deadline → due_date",
      { title: "청첩장 문구 확정", deadline: "2026-10-02" },
      { title: "청첩장 문구 확정", due_date: "2026-10-02" },
    ],
    [
      "due → due_date",
      { title: "청첩장 문구 확정", due: "2026-10-02" },
      { title: "청첩장 문구 확정", due_date: "2026-10-02" },
    ],
    [
      "date → due_date (행동 카드에서만)",
      { title: "청첩장 문구 확정", date: "2026-10-02" },
      { title: "청첩장 문구 확정", due_date: "2026-10-02" },
    ],
    [
      "name → title",
      { name: "청첩장 문구 확정", due_date: "2026-10-02" },
      { title: "청첩장 문구 확정", due_date: "2026-10-02" },
    ],
  ];

  it.each(aliasCases)("%s", (_label, input, expected) => {
    const result = extract("add_amora_action", input);
    expect(result.pendingAction?.input).toEqual(expected);
  });

  it("category → category_key 는 그 이름을 선언하지 않은 도구에서만 바꾼다", () => {
    const action = extract("add_amora_action", {
      title: "청첩장 문구 확정",
      category: "invitation",
    });
    expect(action.pendingAction?.input).toEqual({
      title: "청첩장 문구 확정",
      category_key: "invitation",
    });

    // `update_category_budget` 은 `category` 를 **선언한다.** 여기서 바꾸면
    // 예산 카테고리가 통째로 사라진다.
    const budget = extract("update_category_budget", {
      category: "studio",
      budget: 3_000_000,
    });
    expect(budget.pendingAction?.input).toEqual({
      category: "studio",
      budget: 3_000_000,
    });
  });

  it("모델이 대상 이름을 이미 썼으면 별칭이 그 값을 덮지 않는다", () => {
    const result = extract("add_amora_action", {
      title: "청첩장 문구 확정",
      due_date: "2026-10-02",
      deadline: "2026-12-31",
    });
    expect(result.pendingAction?.input).toEqual({
      title: "청첩장 문구 확정",
      due_date: "2026-10-02",
    });
  });

  it("별칭·모르는 키·목록 밖 값이 한꺼번에 있어도 카드가 난다", () => {
    // X7 이 낸 것으로 추정되는 모양이다. 예전에는 이 중 무엇 하나로도 카드가 0개였다.
    const result = extract("add_amora_action", {
      title: "하객 명단 최종 정리",
      deadline: "9월 30일",
      category: "한복",
      priority: "긴급",
      location: "집",
    });

    expect(result.pendingAction?.input).toEqual({
      title: "하객 명단 최종 정리",
      due_date: "2026-09-30",
      category_key: "general",
      priority: "medium",
    });
  });

  it("필수 필드는 별칭으로도 채워지지 않으면 버린다", () => {
    // `title` 이 없다. 이름을 맞춰 볼 대상도 없으므로 스키마 검증에서 버려진다.
    const result = extract("add_amora_action", {
      deadline: "2026-09-25",
      location: "종로 한복거리",
    });

    expect(result.pendingAction).toBeNull();
    expect(result.hadPendingActionTag).toBe(true);
  });

  it("모르는 키를 버려서 빈 카드가 될 것 같으면 카드를 내지 않는다", () => {
    // `update_category_budget` 의 required 는 `category` 하나뿐이다. 금액을
    // `amount` 라고 쓴 표식에서 그 키만 버리면 스키마는 통과하지만, 사용자가
    // 확인을 누르는 순간 실행기가 `invalid_category_budget` 으로 거절한다.
    // **카드를 눌렀는데 아무것도 저장되지 않는 것은 카드가 안 나오는 것보다 나쁘다.**
    const result = extract("update_category_budget", {
      category: "studio",
      amount: 3_000_000,
    });

    expect(result.pendingAction).toBeNull();
    expect(result.hadPendingActionTag).toBe(true);
  });

  it("보정된 카드는 사용자가 확인할 때 그대로 다시 통과한다", () => {
    const issued = extract("add_amora_action", {
      title: "혼주 한복 예약",
      due_date: "9월 25일",
      category_key: "한복",
    });
    expect(issued.pendingAction).not.toBeNull();

    const resolved = resolveAmoraPendingAction({
      value: issued.pendingAction,
      confirmedActionId: ACTION_ID,
      allowedTools: PROPOSABLE_TOOLS,
      now: NOW + 1_000,
    });

    expect(resolved?.input).toEqual({
      title: "혼주 한복 예약",
      due_date: "2026-09-25",
      category_key: "general",
    });
    expect(resolved?.confirmation).toBe(issued.pendingAction?.confirmation);
  });
});

describe("일정 추가도 같은 원칙을 따른다", () => {
  it("목록 밖 카테고리는 '일반'으로, 형식이 틀린 시간은 뺀다", () => {
    const result = extract("add_schedule_event", {
      date: "2026-09-10",
      title: "신혼집 지역 정하기",
      time: "오후 2시",
      category_key: "신혼집",
      schedule_scope: "shared_commitment",
    });

    expect(result.pendingAction?.input).toEqual({
      date: "2026-09-10",
      title: "신혼집 지역 정하기",
      category_key: "general",
      schedule_scope: "shared_commitment",
    });
    expect(result.cleanText).toContain("- 일정 성격: 두 사람이 함께 정할 약속");
    expect(result.cleanText).not.toContain("- 시간:");
  });

  it("필수 날짜의 형식이 틀리면 지금처럼 버린다", () => {
    // `date` 는 필수다. 여기까지 관대해지면 사용자가 확인한 날짜와 저장되는
    // 날짜가 달라질 수 있다.
    const result = extract("add_schedule_event", {
      date: "9월 10일",
      title: "신혼집 지역 정하기",
    });

    expect(result.pendingAction).toBeNull();
  });
});
