import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const captureMessage = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  captureMessage: (...args: unknown[]) => captureMessage(...args),
}));

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
  // 2026-09-03: "머리채를 잡혔어요" 를 뺐다. **좁은 그물이 이제 잡는다** —
  // 미탐 135건을 메우면서 `머리채(를) 잡` 이 폭력 패턴에 들어갔다.
  // 이 목록은 "아직 못 잡는 것" 의 장부이므로, 잡히게 된 문장은 여기 있으면
  // 안 된다. 남은 여덟은 여전히 못 잡는다.
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

  /**
   * 위 검사는 **금지 문자열 세 개만** 본다. 2026-09-01 적대적 감사가 그 틈으로
   * 들어왔다 — 로그에 `raw: text.slice(9)` 를 더해 원문 20자 중 11자를 그대로
   * 실었는데도 위 검사가 초록불이었다(금지한 `몰래`·`짐`·전문 셋을 피해 갔다).
   *
   * 그래서 **금지 목록이 아니라 허용 목록으로** 묻는다. 무엇이 없어야 하는지가
   * 아니라 무엇만 있어도 되는지를 고정한다.
   */
  it("로그 payload 에는 상황 이름과 길이 말고 아무것도 없다", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    observeAmoraSafetyRecall("그 사람 몰래 짐 싸서 나가려고 해요", false);

    expect(warn).toHaveBeenCalledTimes(1);
    const payload = warn.mock.calls[0][1] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(["categories", "textLength"]);
    expect(payload.textLength).toBe("그 사람 몰래 짐 싸서 나가려고 해요".length);
  });
});

/**
 * 한 발화가 두 상황에 걸리면 **둘 다** 세야 한다. 장부의 쓸모가 거기 있다 —
 * 어떤 상황이 겹쳐 오는지가 나중 판단의 근거다.
 *
 * 2026-09-01 감사가 심은 변형(첫 매치에서 루프 중단)이 초록불로 통과했다.
 * 그 변형이 설치되면 아래가 한 개만 세어져 빨개진다.
 */
/**
 * 이 장부가 **사람에게 닿는지**.
 *
 * 2026-09-01 에 세어 보니 이 기록을 읽는 곳이 저장소에 하나도 없었다 —
 * `console.warn` 이 Vercel 런타임 로그에 남고 끝이었고, Sentry 는 console 을
 * 잡지 않으며 조회 스크립트도 크론도 없었다. 같은 날 안전망 구멍 하나를
 * 사람이 손으로 대화를 읽다가 찾았다. 어휘 그물은 다음 구멍을 원리적으로
 * 알 수 없으니, 뚫렸다는 사실이라도 닿아야 한다.
 */
describe("놓친 것이 사람에게 닿는다", () => {
  beforeEach(() => {
    captureMessage.mockClear();
  });

  it("좁은 그물이 놓치면 Sentry 로 보낸다", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    observeAmoraSafetyRecall("그 사람 몰래 짐 싸서 나가려고 해요", false);

    expect(captureMessage).toHaveBeenCalledTimes(1);
    const [message, options] = captureMessage.mock.calls[0] as [string, Record<string, unknown>];
    expect(message).toContain("safety-recall");
    expect((options as { level?: string }).level).toBe("warning");
    expect((options as { tags?: Record<string, string> }).tags).toEqual({
      safety_recall_categories: "escape_planning",
      safety_recall_text_length: "20",
    });
  });

  it("좁은 그물이 이미 잡았으면 보내지 않는다", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    observeAmoraSafetyRecall("남편이 저를 밀쳤어요", true);
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it("보내는 것에 사용자가 쓴 문장이 들어가지 않는다", () => {
    // 스크러버(`sanitizeSentryEvent`)는 `extra` 를 통째로 버리지만 `message` 는
    // URL·이메일·전화 패턴만 지운다 — **한국어 문장은 하나도 안 걸린다.**
    // 그래서 여기서 못 박는다: 어느 자리에도 원문이 없어야 한다.
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const secret = "그 사람 몰래 짐 싸서 나가려고 해요";
    observeAmoraSafetyRecall(secret, false);

    const sent = JSON.stringify(captureMessage.mock.calls);
    expect(sent).not.toContain(secret);
    expect(sent).not.toContain("몰래");
    expect(sent).not.toContain("나가려고");
    expect(sent).toContain("escape_planning");
  });

  it("Sentry 가 던져도 사용자 요청을 죽이지 않는다", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    captureMessage.mockImplementationOnce(() => { throw new Error("sentry down"); });
    expect(() => observeAmoraSafetyRecall("그 사람 몰래 짐 싸서 나가려고 해요", false))
      .not.toThrow();
  });
});

describe("겹치는 상황을 전부 센다", () => {
  it("한 문장이 두 상황에 걸리면 둘 다 기록한다", () => {
    const categories = classifyAmoraSafetyRecallCategories(
      "그 사람 몰래 짐 싸서 나가려고 해요. 집에 들어가는 게 무서워요.",
    );
    expect(categories).toContain("escape_planning");
    expect(categories).toContain("fear");
    expect(categories.length).toBeGreaterThanOrEqual(2);
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

/**
 * 2026-09-01 적대적 감사가 잡은 세 부류. 셋 다 처음 만들 때 내 반례가 **그 경로를
 * 한 번도 안 밟아서** 초록불이었다. 여기 고정해 다시 못 들어오게 한다.
 */
describe("이중부정은 진짜 신호다 — 부정문 방어에 걸리면 안 된다", () => {
  it.each([
    "없어지고 싶지 않은 날이 하루도 없어",
    "사라지고 싶지 않다고 하면 거짓말이야",
    "사라지고 싶지 않은 척하는 것도 지쳤어",
    "없어지고 싶지 않다는 말이 안 나와",
  ])("'%s'", (text) => {
    expect(classifyAmoraSafetyRecallCategories(text)).toContain("self_harm");
  });

  it("그래도 '포기하고 싶지 않은' 은 세지 않는다 — 운영에 실제로 있던 문장이다", () => {
    expect(
      classifyAmoraSafetyRecallCategories("내가 절대 포기하고 싶지 않은 한 가지는 예식 순서야"),
    ).not.toContain("self_harm");
  });
});

describe("'살다' 는 이 제품에서 대개 거주다", () => {
  it.each([
    "신혼집에서 둘이 잘 살 자신이 없어",
    "이 동네에 계속 살 이유가 없어",
    "시부모님이랑 합가해서 살 자신이 없어요",
    "전세로 2년 더 살 이유가 없는 것 같아",
    "그 집에서 30년 살 자신은 없지",
  ])("'%s' 는 세지 않는다", (text) => {
    expect(classifyAmoraSafetyRecallCategories(text)).not.toContain("self_harm");
  });

  it("그래도 '살아갈 자신이 없어' 는 센다", () => {
    expect(classifyAmoraSafetyRecallCategories("살아갈 자신이 없어")).toContain("self_harm");
  });
});

describe("'일어나다' 는 사건이 발생한다는 뜻이기도 하다", () => {
  it.each([
    "본식 때 아무 일도 안 일어나도록 미리 점검하자",
    "예식 중에 사고가 안 일어나도 안심이 안 돼",
    "하객 동선에 혼잡이 안 일어나도록 안내를 세우자",
    "지연이 안 일어나도 30분 여유는 두자",
  ])("'%s' 는 세지 않는다", (text) => {
    expect(classifyAmoraSafetyRecallCategories(text)).not.toContain("self_harm");
  });

  it("잠 문맥이 있으면 센다", () => {
    for (const text of [
      "아침에 안 일어나도 괜찮을 것 같아",
      "요즘은 그냥 자다가 안 일어났으면 싶어",
      "이대로 잠들면 안 깨어났으면 좋겠어",
    ]) {
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
  // 2026-09-03: 하나이던 것이 둘이 됐다. "이 세상에서 조용히 지워지고 싶어" 를
  // 좁은 그물이 이제 잡는다 — 미탐 135건을 메우면서 `지워지고 싶` 이 들어갔고,
  // 창피함 문맥(민망·창피·사진)에서는 무르도록 함께 넣었다.
  //
  // 위 주석이 말하는 "별도의 결정" 이 그것이다. 조용히 바뀐 것이 아니라
  // 같은 코퍼스로 base 와 나란히 재서 오탐이 늘지 않는 것을 확인하고 넣었다.
  const ALREADY_CAUGHT_BY_NARROW = [
    "다 던져버리고 나도 같이 사라지고 싶어",
    "이 세상에서 조용히 지워지고 싶어",
  ];

  it.each(PASSIVE_IDEATION.filter((t) => !ALREADY_CAUGHT_BY_NARROW.includes(t)))(
    "'%s' 는 좁은 그물이 여전히 못 잡는다 — 넓힌 것은 장부뿐이다",
    (text) => {
      expect(hasAmoraSafetySignal(text, "chat")).toBe(false);
    },
  );

  it("좁은 그물이 잡는 것은 그대로 잡는다", () => {
    for (const text of ALREADY_CAUGHT_BY_NARROW) {
      expect(hasAmoraSafetySignal(text, "chat"), text).toBe(true);
    }
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
