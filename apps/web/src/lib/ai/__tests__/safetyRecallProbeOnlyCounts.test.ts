import { afterEach, describe, expect, it, vi } from "vitest";

import {
  classifyAmoraSafetyRecallCategories,
  observeAmoraSafetyRecall,
} from "@/lib/ai/amoraSafetyRecallProbe";
import { hasAmoraSafetySignal } from "@/lib/ai/amoraQuestionScope";

/**
 * 좁은 그물이 무엇을 놓치는지 **세기만** 한다.
 *
 * 2026-08-25 측정 — 정규식을 보지 않고 상황에서 출발해 쓴 위험 발화 19문장 중
 * 2문장만 잡혔다(약 10%). 그런데 같은 날 운영 장부에서는 사람이 쓴 687건 중
 * 넓은 그물에만 걸리는 것이 1건이었다. **비율은 나쁘고 빈도는 낮다.**
 *
 * 그래서 지금 할 일은 어휘를 넓히는 것이 아니라(넓히면 평범한 결혼 문장이
 * 함께 걸린 기록이 이 저장소에 여러 번 있다) **얼마나 새는지 아는 것**이다.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

/** 좁은 그물이 실제로 놓치는 문장들. 상황에서 출발해 썼다. */
const MISSED_BY_NARROW_NET = [
  "그 사람 몰래 짐 싸서 나가려고 해요",
  "친정으로 도망갈 준비 중이에요",
  "제 월급을 다 가져가고 용돈만 줘요",
  "친구 만나는 걸 못 하게 해요",
  "헤어지자고 하면 가만 안 둔다고 했어요",
  "어제 팔을 세게 잡아서 멍이 들었어요",
  "머리채를 잡혔어요",
  "싫다고 했는데 계속했어요",
  "집에 들어가는 게 무서워요",
];

describe("좁은 그물이 놓치는 것을 넓은 그물이 센다", () => {
  it.each(MISSED_BY_NARROW_NET)("'%s' 는 좁은 그물이 못 잡는다", (text) => {
    // 이 전제가 바뀌면(어휘를 넓히면) 아래 검사의 의미가 달라진다.
    expect(hasAmoraSafetySignal(text, "chat")).toBe(false);
  });

  it.each(MISSED_BY_NARROW_NET)("'%s' 를 넓은 그물은 센다", (text) => {
    expect(classifyAmoraSafetyRecallCategories(text).length).toBeGreaterThan(0);
  });
});

describe("동작을 바꾸지 않는다", () => {
  it("좁은 그물의 판정을 되돌려 주지 않는다 — 관찰만 한다", () => {
    const observation = observeAmoraSafetyRecall("그 사람 몰래 나가려고 해요", false);
    // `narrow` 는 호출부가 넘긴 값 그대로다. 이 함수가 뒤집지 않는다.
    expect(observation.narrow).toBe(false);
    expect(observation.wide).toBe(true);
  });

  it("좁은 그물이 이미 잡았으면 기록하지 않는다", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    observeAmoraSafetyRecall("남편이 저를 밀쳤어요", true);
    expect(warn).not.toHaveBeenCalled();
  });

  it("놓친 것만 기록한다", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    observeAmoraSafetyRecall("그 사람 몰래 짐 싸서 나가려고 해요", false);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("원문을 남기지 않는다", () => {
  it("로그에 사용자가 쓴 문장이 들어가지 않는다", () => {
    // `CLAUDE.md`: "AI 감사 로그에는 질문·답변·첨부·도구 입력 원문을 복제하지
    // 않는다." 하물며 이 로그가 담을 수 있는 것은 가정폭력 서술이다.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const secret = "그 사람 몰래 짐 싸서 나가려고 해요";
    observeAmoraSafetyRecall(secret, false);

    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain(secret);
    expect(logged).not.toContain("몰래");
    expect(logged).not.toContain("짐");
    // 남는 것은 상황 이름과 길이뿐이다.
    expect(logged).toContain("escape_planning");
  });
});

describe("평범한 결혼 대화는 세지 않는다", () => {
  it.each([
    "예식장 계약금 500만원 냈어요",
    "드레스 투어 언제가 좋아?",
    "축가 부를 친구를 못 정했어",
    "시어머니가 예단 얘기를 꺼내셨어요",
    "신혼여행 예산 500만원으로 잡아줘",
    "청첩장 시안 세 개 중에 골라줘",
  ])("'%s'", (text) => {
    // 오탐이 많으면 로그가 쓸모없어진다. 차단은 안 하지만 숫자는 읽을 수 있어야 한다.
    expect(classifyAmoraSafetyRecallCategories(text)).toEqual([]);
  });
});
