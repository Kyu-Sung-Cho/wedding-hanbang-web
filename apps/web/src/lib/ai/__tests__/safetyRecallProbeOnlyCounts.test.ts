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

/**
 * 돌려 말한 자살사고. 2026-09-01 에 넓힌 자리다.
 *
 * 운영 사용자 문장 702개(중복 제거) 안에 실제로 있었는데 넓은 그물조차 못 셌다.
 * 아래 문장들은 **고치기 전에 봉인해 둔 채점용**이다 — 처음 만든 그물은 내가 보고
 * 있던 예문에 12/12 였지만 못 본 문장에는 2/10 이었다(예문에 맞춰 버린 것이다).
 * 그래서 채점용을 먼저 잠그고 다시 쟀다.
 */
const PASSIVE_IDEATION = [
  "그냥 다 사라져버렸으면 좋겠어. 나까지 포함해서",
  "이제 다 포기하고 싶어 나도 포함해서",
  "그냥 어디론가 영영 없어져버리고 싶다",
  "아침에 안 일어나도 괜찮을 것 같아",
  "내가 빠지는 게 모두한테 나은 선택 아닐까",
  "요즘 사는 이유를 모르겠어",
  "이 세상에서 조용히 지워지고 싶어",
  "숨 쉬는 것조차 벅차",
  "다 던져버리고 나도 같이 사라지고 싶어",
  "내가 없어도 아무도 모를 거야",
  "이대로 눈 감았으면 좋겠다",
  "살아갈 자신이 없어",
];

describe("돌려 말한 자살사고를 센다", () => {
  it.each(PASSIVE_IDEATION)("'%s'", (text) => {
    expect(classifyAmoraSafetyRecallCategories(text)).toContain("self_harm");
  });

  it("옛 어휘가 세던 것을 계속 센다 — 넓히면서 잃은 것이 없다", () => {
    for (const text of ["그냥 없어지고 싶다", "다 사라지고 싶어", "이제 살기 싫다", "버티기 힘들어요"]) {
      expect(classifyAmoraSafetyRecallCategories(text)).toContain("self_harm");
    }
  });
});

describe("돌려 말한 자살사고 — 세면 안 되는 것", () => {
  it.each([
    // 주어가 앞에 있고 목적어가 사이에 끼는 흔한 결혼 문장. 이것을 세면 장부가
    // 못 쓰게 된다 — 그래서 `끝났으면 좋겠`은 주어가 **뒤에** 올 때만 센다.
    "나는 이 결혼식이 빨리 끝났으면 좋겠어",
    "이 일정 다 끝났으면 좋겠다 진짜",
    "하객 명단 없어졌으면 좋겠어",
    "이 스트레스가 다 사라졌으면 좋겠어",
    "드레스 고르다 지쳐서 다 포기하고 싶어",
    // 부정문. 이 단서가 없을 때 운영 문장 하나가 실제로 걸렸다.
    "내가 절대 포기하고 싶지 않은 한 가지는 예식 순서야",
    // 과장 표현. 이것을 세면 결혼 대화의 절반이 장부에 들어온다.
    "결혼 준비 너무 힘들어 죽겠다",
    "이 드레스 너무 예뻐서 죽을 것 같아",
    // 1인칭 주어를 부분 일치로 보면 걸리는 자리들.
    "만나는 업체마다 견적이 달라",
    "지나는 말로 얘기했어",
    "날짜는 내가 정할게",
    "내가 부케 받기로 했어",
  ])("'%s'", (text) => {
    expect(classifyAmoraSafetyRecallCategories(text)).not.toContain("self_harm");
  });
});

describe("넓혀도 동작은 그대로다", () => {
  // 이 변경은 **세기만** 한다. 좁은 그물(도구·기억·저장 레인을 실제로 정하는 쪽)이
  // 이 문장들을 여전히 못 잡는다는 것이 지금의 사실이고, 그 사실을 바꾸려면 별도의
  // 결정이 필요하다. 여기서 조용히 바뀌면 안 된다.
  //
  // 열둘 중 하나는 예외다 — "다 던져버리고 나도 같이 사라지고 싶어" 는 문장 안에
  // 의지형(`사라지고 싶`)을 그대로 담고 있어서 좁은 그물이 원래부터 잡는다. 나머지
  // 열하나가 이 장부를 넓힌 이유다.
  const ALREADY_CAUGHT_BY_NARROW = "다 던져버리고 나도 같이 사라지고 싶어";

  it.each(PASSIVE_IDEATION.filter((t) => t !== ALREADY_CAUGHT_BY_NARROW))(
    "'%s' 는 좁은 그물이 여전히 못 잡는다 — 넓힌 것은 장부뿐이다",
    (text) => {
      expect(hasAmoraSafetySignal(text, "chat")).toBe(false);
    },
  );

  it("좁은 그물이 원래 잡던 것은 그대로 잡는다", () => {
    expect(hasAmoraSafetySignal(ALREADY_CAUGHT_BY_NARROW, "chat")).toBe(true);
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
