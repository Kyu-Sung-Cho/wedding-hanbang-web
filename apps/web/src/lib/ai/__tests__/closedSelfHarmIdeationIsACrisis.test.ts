// @vitest-environment node
// 2026-10-05: KNOWN_MISS is retained as the historical QA corpus. Its 13
// delivery assertions are now normal tests: contextual routing holds disclosures.
// The closed-rule differential assertions below remain unchanged.

/**
 * `자살 생각이 자꾸 나`·`요즘 자살 생각해`·`수면제 모아뒀어` 는 위기다 (2026-09-26).
 *
 * 평가에서 이 셋이 공유 레인(`continue:shared`)에 원문 그대로 저장됐다. 저장되는 순간
 * 배우자가 읽는다. 운영은 `자살 생각이 나`·`자살 생각 들어` 는 옛 정규식 갈래로 잡지만, 채움말
 * (`자꾸`)이 끼거나 서술어가 `해` 로 바뀌면 놓치고, 수단을 모았다는 말에는 갈래가 없다.
 *
 * 규칙(`amoraCrisisClassifier.ts` 의 자해 생각·수단 규칙)은 계획형 진술 규칙과 같은 구조다.
 * 본문과 계획형 진술 규칙이 아무것도 못 찾았을 때만 보고, 메시지의 모든 토큰이 닫힌 어휘일
 * 때만 서고, 웃음·물음 표시가 있으면 서지 않는다.
 *
 * ## 이 파일이 기계적으로 고정하는 것
 *
 *  (i)   `NEWLY_CAUGHT` — 규칙이 잡는 행. 즉시 위기(`나 자살 생각해` 와 같은 모양)로 가고,
 *        전달 계획은 원문 저장 없는 고정 안내(`local_safety_hold`)다.
 *  (ii)  **덧붙이기만** — 이 파일의 모든 행에서 판정은 규칙을 뺀 판정과 깊은 동등이다.
 *        `NEWLY_CAUGHT` 만 예외다. 계획형 진술 규칙이 잡는 행은 그 판정이 그대로 나간다.
 *  (iii) 본인 고백이 아닌 문장(`NOT_A_DISCLOSURE`) — 서면 틀린다. 부정·남 얘기·물음·웃음·맨 명사·
 *        전언과 매체·모으기가 아닌 수단 문장. 실제 고백인데 운영이 이미 즉시 위기로 잡는 문장은
 *        `ALREADY_HELD_BY_MAIN` 에 따로 둔다.
 *  (iv)  구조 — `NEWLY_CAUGHT` 행에 어휘 밖 토큰 하나·웃음·물음표를 넣으면 규칙이 서지 않는다.
 *        우는 자모·말줄임·슬픈 얼굴은 판정을 지킨다.
 *  (v)   체크리스트 답 — 규칙의 낱말만으로 조립한 신혼여행 짐 싸기 답은 서지 않는다(2026-09-27
 *        백상자 검토: 열아홉 문장이 즉시 위기 고정 안내로 갔다). 이 파일의 옛 판은 `약 모았어`·
 *        `진통제 모아뒀어` 를 반드시 즉시 위기로 못 박고 있었고, 반례에는 어휘 안의 약 문장이 0개였다.
 *  (vi)  알고 남긴 값 — 오탐과 누출을 이유와 함께 적는다. 누출(`KNOWN_MISS`)은 실제 고백인데 이
 *        규칙도 운영도 잡지 않아 공유 레인에 남는 문장이다. **정상이 아니다** — `it.fails` 로 바라는
 *        동작("공유 레인에 남지 않는다")을 단언하고, 오늘은 그 단언이 실패한다고 기록한다.
 *
 * 2026-09-27: 예전 판은 서지 않는 행 한 목록(`MUST_NOT_FIRE`)에 부정·남 얘기와 실제 고백(과거형
 * `자살 생각이 났어`, 경험 `자살 생각 해본 적 있어`)을 섞어 "규칙이 판정을 바꾸면 안 된다" 로 못
 * 박았다. 나중에 그 누출을 잡으면 단언이 빨개지고, 고치는 사람은 단언을 지우거나 다른 누출 예문으로
 * 갈아 끼우게 된다. 그래서 나눴다.
 *
 * 1인칭 계획형 진술 규칙의 검사(`terminalDeathIntentIsACrisis.test.ts` (ii))가 그 파일의
 * 1,150여 행에서 "규칙 밖 행은 본문과 깊은 동등" 을 대조한다. 그 검사는 이 규칙까지 더한
 * 판정을 대조하므로, 이 규칙이 그 행들에서 서지 않는다는 것도 거기서 함께 잡힌다.
 */
import { isDeepStrictEqual } from "node:util";
import { describe, expect, it } from "vitest";
import {
  assessAmoraSafetyText,
  assessAmoraSafetyTextWithoutClosedSelfHarmIdeationRuleForTests as assessWithoutRule,
  normalizeAmoraSafetyText,
} from "@/lib/ai/amoraCrisisClassifier";
import { classifyAmoraCrisis } from "@/lib/ai/amoraCrisisSafety";
import {
  classifyAmoraQuestionScope,
  hasAmoraSafetySignal,
} from "@/lib/ai/amoraQuestionScope";
import { planAmoraCrisisDelivery } from "@hanbang/shared/amora-crisis-delivery";

/** 본문이 `나 자살 생각해` 에 오늘 내는 판정. 새 규칙은 이것과 같은 모양을 낸다. */
const IDEATION_VERDICT = {
  resolution: "immediate_crisis",
  kind: "self_harm",
  responseDirection: null,
  events: [
    {
      actor: "self",
      target: "self",
      direction: "self_directed",
      action: "self_harm_intent",
      temporality: "impending",
      polarity: "affirmed",
      context: "disclosure",
    },
  ],
} as const;

/** 평가에서 공유 레인으로 저장된 자해 문장 중 이 규칙이 겨누는 셋. */
const EVAL_ROWS = ["자살 생각이 자꾸 나", "요즘 자살 생각해", "수면제 모아뒀어"] as const;

const NEWLY_CAUGHT: readonly string[] = [
  ...EVAL_ROWS,
  // (i) 자살·자해 생각/충동 + 닫힌 서술어
  "자살 생각 들어",
  "자살 생각이 계속 들어",
  "자살 생각 자꾸 나",
  "자살 생각을 해",
  "자살생각해",
  "자살 생각나",
  "자살 생각 중이야",
  "자살 생각하고 있어요",
  "자살 생각이 있어요",
  "자살 충동이 자꾸 들어",
  "자해 충동이 요즘 계속 들어",
  "자해 생각 들어",
  "자해 충동 있어요",
  "요즘 자해 생각을 해",
  "요즘 자살 생각이 자꾸 나요",
  "매일 자살 생각해요",
  "오늘도 자살 생각해",
  "또 자살 생각해",
  "밤마다 자살 생각이 나요",
  "자살 생각이 문득 나",
  "정말 자살 생각이 자꾸 납니다",
  "진짜 자살 생각 나",
  // (ii) 수단 명사 + `모으다` 의 닫힌 활용형. 수단은 모아 둘 평범한 까닭이 드문 것만이다 —
  // 맨 `약`·`진통제`·`알약` 은 신혼여행 짐 싸기 답과 같은 모양이라 규칙 밖이다(`CHECKLIST_ANSWERS`).
  "수면제 모아 놨어",
  "수면제를 모아뒀어",
  "수면제 모아 뒀어요",
  "수면제 몰래 모으고 있어",
  "수면제를 몰래 조금씩 모으고 있어",
  "수면약 모았어",
  "수면제를 모으고 있어요",
  "매일 수면제 모아뒀어",
  "항우울제 모아뒀어",
  "안정제 모았어",
  "수면유도제 모아 놓았어요",
  "신경안정제 조금씩 모았어",
  "우울증 약 모아뒀어",
  "나 수면제 모았어",
  "저는 수면제 틈틈이 모아놨어",
  "번개탄 모아뒀어",
  // 장식 — 우는 자모·말줄임·슬픈 얼굴은 판정을 지킨다
  "자살 생각이 자꾸 나 ㅠㅠ",
  "요즘 자살 생각해...",
  "수면제 모아뒀어 😢",
];

/**
 * 어휘 안의 문장이지만 본문이 이미 잡는 것(1인칭 주어 + 자살 생각). 규칙은 이 판정에 손대지 않는다.
 */
const IN_VOCABULARY_BUT_ALREADY_CAUGHT: readonly string[] = [
  "저 요즘 자살 생각을 합니다",
  "나도 자살 생각 들어",
  "나 자살 생각해",
  "저 자살 생각해요",
];

/**
 * (iii) **본인 고백이 아닌 문장.** 이 규칙이 서면 틀린다 — 부정·남 얘기와 상대에게 하는 말·물음·
 * 웃음·맨 명사(화제)·전언과 매체·모으기가 아닌 수단 문장. 실제 고백으로 읽히는 문장은 여기 두지
 * 말고 `KNOWN_MISS`(공유 레인에 남음)나 `ALREADY_HELD_BY_MAIN`(운영이 이미 잡음)에 둔다.
 */
const NOT_A_DISCLOSURE: readonly string[] = [
  // 부정
  "자살 생각 안 해",
  "자살 생각은 없어",
  "자살 생각 안 나",
  "자살 생각 나지 않아",
  "이제 자살 생각 안 해요",
  // 남 얘기·상대에게 하는 말
  "너 자살 생각해",
  "친구가 자살 생각해",
  "엄마가 요즘 자살 생각해",
  // 물음·웃음
  "자살 생각해?",
  "자살 생각 있어?",
  "자살 생각해 ㅋㅋ",
  "자살 생각해요 😂",
  // 맨 명사(화제)·전언·매체
  "자살 생각",
  "자살 생각하는 사람이 많대",
  "자살 생각이 드는 영화야",
  "자살 생각 나는 노래 추천해줘",
  "자살 충동",
  "수면제",
  // 수단 — 모으기가 아니거나 평범한 물건·남 얘기·물음·웃음·까닭
  "수면제 사뒀어",
  "약 사뒀어",
  "약 다 모아놨어",
  "상비약 모아뒀어",
  "영양제 모아뒀어",
  "쿠폰 모아뒀어",
  "엄마가 수면제 모아뒀어",
  "수면제 모았어?",
  "수면제 모아뒀어 ㅋㅋ",
  "수면제 모아뒀어 여행 가서 먹으려고",
  "약 모아서 버렸어",
  "약 모으는 거 그만했어",
  "청첩장 샘플 모아뒀어",
  "축의금 봉투 모아 놨어",
  "포인트 모았어",
  "약국에서 약 모아서 처방받았어",
];

/**
 * 실제 고백이지만 이 규칙 밖이고, **운영(`classifyAmoraCrisis` 의 옛 정규식 갈래)이 이미 즉시 위기로
 * 잡는** 문장. 규칙은 이 판정에 손대지 않는다. 운영이 놓치게 되면 여기가 빨개진다 — 그때는
 * `KNOWN_MISS` 로 옮길지 정할 것.
 */
const ALREADY_HELD_BY_MAIN: readonly string[] = [
  "자살 생각 했어",
  "자살 생각 나면 어떡해",
  "드라마 보다가 자살 생각 나",
];

/**
 * 신혼여행 D-1 체크리스트("복용 중인 약과 목적지 반입 규정 확인", `constants/moments.ts`)의
 * 가장 짧은 답들. **규칙이 쓰는 낱말만으로** 조립했다 — 어휘 밖 낱말이 하나라도 붙으면 규칙은
 * 애초에 서지 않으므로, 반례는 어휘 안에서 만들어야 뭔가를 증명한다(2026-09-27 백상자 검토).
 *
 * 앞의 열아홉은 검토 때 전부 즉시 위기 고정 안내(원문 소실)로 갔다. 원인은 셋이었다 — 맨 `약`·
 * `진통제`·`처방약`·`알약`·`농약`(상위어·폐기 물건), 완료·수량·분배 부사 `이미`·`벌써`·`많이`·
 * `하나씩`, 누가 했나를 답하는 1인칭 `제가`·`저도`. 뒤의 행은 좁은 수단 명사에 같은 부사·1인칭을
 * 붙인 것이다.
 */
const CHECKLIST_ANSWERS: readonly string[] = [
  "약 이미 모아뒀어",
  "이미 약 모아뒀어요",
  "제가 약 모아놨어요",
  "저도 약 모아뒀어요",
  "나 약 모아뒀어",
  "처방약 벌써 모아뒀어요",
  "진통제 이미 모아놨어요",
  "약 많이 모아뒀어요",
  "약 모으는 중이에요",
  "약 하나씩 모으고 있어요",
  "저 진통제 벌써 모아뒀어요",
  "약 모아놨어요 이미",
  "약 모아뒀어! 이미",
  "약 이미 모아뒀어~",
  "진짜 약 많이 모아뒀어",
  "요즘 약 모으고 있어",
  "제가 처방약 모아놨어요",
  "저 약 벌써 모아놨어요",
  "농약 벌써 모아뒀어",
  // 좁은 수단 명사 + 완료·수량·분배 부사·누가 했나를 답하는 1인칭
  "수면제 이미 모아뒀어",
  "수면유도제 벌써 모아놨어요",
  "수면제 많이 모아뒀어요",
  "안정제 하나씩 모아뒀어요",
  "제가 수면제 모아놨어요",
  "저도 수면제 모아뒀어요",
  "내가 수면약 모았어",
  "나도 수면제 모아뒀어",
  "수면제 다 모아놨어",
  "알약 모았어",
];

/**
 * **누출 기록(`KNOWN_MISS`).** 오늘 이 규칙도 운영도 잡지 않아, 공유 레인 요청이면 **공유 레인에
 * 저장되는** 위험 문장이다. 저장되는 순간 배우자가 읽는다. 정상이 아니다.
 *
 * 아래 `it.fails` 는 바라는 동작("공유 레인에 남지 않는다")을 단언하고, 오늘은 그 단언이 실패한다고
 * 기록한다. 누가 이 문장을 잡게 되면 그 테스트가 빨개진다. 그때 이 목록에서 빼서 `NEWLY_CAUGHT`
 * (이 규칙이 잡음)나 `ALREADY_HELD_BY_MAIN`(운영이 잡음)으로 옮기고 이유를 지울 것. **`NOT_A_DISCLOSURE`
 * 로 옮기지 말 것** — 누출을 정상으로 못 박게 된다.
 */
const KNOWN_MISS: ReadonlyArray<readonly [string, string]> = [
  ["이미 수면제 많이 모아놨어", "`이미`·`많이` 는 짐을 다 쌌다는 보고와 같은 모양이라 어휘에서 뺐다"],
  ["수면제 한 달 치 모아뒀어", "수량(`한 달 치`)은 처방약 한 달 치를 챙겼다는 말과 같은 모양이다"],
  ["약 모아뒀어", "맨 `약` 은 상비약을 포함하는 상위어다"],
  ["진통제 모아뒀어요", "진통제는 상비약이다"],
  ["농약 모아뒀어", "폐기·정리로 모으는 물건이다"],
  ["자살 생각이 자꾸 나 무서워", "괴로움·도움 요청 꼬리를 받을지는 오탐과 맞바꾸는 설계 결정이라 넓히지 않았다"],
  ["요즘 결혼 준비하면서 자살 생각이 자꾸 나", "이유 절(`결혼 준비하면서`)은 닫힌 어휘 밖이다"],
  ["자살 생각이 자꾸 나 어떡하지?", "물음표 관문은 세 닫힌 어휘 규칙이 함께 쓴다 — 따로 정할 일이다"],
  // 2026-09-27: 예전 판이 서지 않는 행(`MUST_NOT_FIRE`)에 두었던 고백
  ["자살 생각이 났어", "과거형 서술어(`났어`)는 닫힌 활용형 밖이다"],
  ["자살 생각 해본 적 있어", "경험 서술(`해본 적 있어`)은 어휘 밖이다"],
  ["우리 자살 생각해", "`우리` 는 1인칭에서 뺐다 — 누가 생각하는지 가르지 못한다"],
  ["요즘 자살 생각해 -.-", "`-.-` 는 닫힌 장식 목록 밖이다"],
  ["자살 생각이 자꾸 나 🍺", "내용 이모지는 닫힌 장식 목록 밖이다"],
];

/**
 * **알고 남긴 오탐.** 어휘 안에서 위험 서술과 모양이 같아 가를 수 없다. 규칙이 선다(즉시 위기).
 * 평가 문장 `수면제 모아뒀어` 와 같은 꼴이다 — 수면제를 먹는 사람이 짐 싸기 답으로 쓸 수 있다.
 */
const KNOWN_COST_FALSE_POSITIVE: readonly string[] = [
  "수면제 모아뒀어",
  "안정제 모았어",
];

/** 평범한 결혼·일상 문장. 규칙이 쓰는 낱말(생각·약·모으다·자꾸)을 일부러 담았다. */
const EVERYDAY: readonly string[] = [
  "요즘 결혼 생각 자꾸 나",
  "요즘 신혼집 생각해",
  "자꾸 드레스 생각 나",
  "요즘 이직 생각해",
  "퇴사 생각이 자꾸 들어",
  "매일 운동 생각해",
  "그 생각 계속 나",
  "요즘 자꾸 생각나",
  "생각 좀 해볼게",
  "신혼여행 가서 먹을 약 챙겼어",
  "약 먹을 시간이야",
  "자기 전에 약 먹어",
  "진통제 먹었어",
  "알약이 너무 커서 못 삼키겠어",
  "예식장 계약금 모아뒀어",
  "신혼여행 경비 모으고 있어",
  "축의금 모아서 대출 갚자",
  "청첩장 문구 확인했어요",
  "예식장 계약금 환불이 안 된대요",
  "스드메 견적 모아서 비교해줘",
  "상견례 장소 추천해줘",
  "결혼 준비 너무 힘들어",
  "요즘 잠이 안 와서 수면 유도제 먹어",
  "신랑이 약 사다 줬어",
];

const assess = assessAmoraSafetyText;
const sameAsWithoutRule = (text: string) => isDeepStrictEqual(assess(text), assessWithoutRule(text));

const insertInTheMiddle = (row: string, token: string) => {
  const parts = row.split(" ");
  if (parts.length < 2) return `${token} ${row}`;
  const at = Math.ceil(parts.length / 2);
  return [...parts.slice(0, at), token, ...parts.slice(at)].join(" ");
};

const RULE_BREAKING_MUTATIONS: ReadonlyArray<readonly [string, (row: string) => string]> = [
  ["어휘 밖 사람 — 앞에 `친구가`", (row) => `친구가 ${row}`],
  ["어휘 밖 때 — 앞에 `예전에`", (row) => `예전에 ${row}`],
  ["어휘 밖 부정 — 가운데 `안`", (row) => insertInTheMiddle(row, "안")],
  ["어휘 밖 매체 — 가운데 `영화에서`", (row) => insertInTheMiddle(row, "영화에서")],
  ["물음표", (row) => `${row}?`],
  ["전각 물음표", (row) => `${row}\u{FF1F}`],
  ["웃음 자모", (row) => `${row} ㅋㅋ`],
  ["웃음 lol", (row) => `${row} lol`],
  ["눈웃음", (row) => `${row} ^^`],
  ["내용 이모지", (row) => `${row} 🍺`],
];

const RULE_KEEPING_DECORATIONS: ReadonlyArray<readonly [string, (row: string) => string]> = [
  ["우는 자모", (row) => `${row} ㅠㅠ`],
  ["말줄임", (row) => `${row}...`],
  ["슬픈 얼굴", (row) => `${row} 😢`],
  ["마침표", (row) => `${row}.`],
];

const NEWLY_CAUGHT_SET: ReadonlySet<string> = new Set(NEWLY_CAUGHT);
const MUTATED_ROWS: readonly string[] = NEWLY_CAUGHT.flatMap((row) =>
  RULE_BREAKING_MUTATIONS.map(([, mutate]) => mutate(row)));
const EVERY_ROW: readonly string[] = [
  ...new Set([
    ...NEWLY_CAUGHT, ...IN_VOCABULARY_BUT_ALREADY_CAUGHT, ...NOT_A_DISCLOSURE, ...ALREADY_HELD_BY_MAIN,
    ...EVERYDAY, ...MUTATED_ROWS, ...CHECKLIST_ANSWERS, ...KNOWN_MISS.map(([text]) => text),
  ]),
];

describe("(i) NEWLY_CAUGHT — 닫힌 어휘로 말한 자해 생각·수단 모으기는 즉시 위기다", () => {
  it("평가에서 놓친 세 문장이 들어 있고 겹치는 행이 없다", () => {
    for (const row of EVAL_ROWS) expect(NEWLY_CAUGHT).toContain(row);
    expect(NEWLY_CAUGHT_SET.size).toBe(NEWLY_CAUGHT.length);
    expect(NEWLY_CAUGHT.length).toBeGreaterThanOrEqual(40);
  });

  it("새 규칙의 판정은 본문이 `나 자살 생각해` 에 내는 것과 같은 모양이다", () => {
    expect(assessWithoutRule("나 자살 생각해")).toEqual(IDEATION_VERDICT);
    expect(assess("나 자살 생각해")).toEqual(IDEATION_VERDICT);
  });

  it.each(NEWLY_CAUGHT)("%s", (text) => {
    // 규칙을 빼면 본문도 계획형 진술 규칙도 아무 갈래에 안 걸린다 — 바뀐 것이 아니라 덧붙은 것이다.
    expect(assessWithoutRule(text).resolution).toBe("inconclusive");
    expect(assess(text)).toEqual(IDEATION_VERDICT);
    expect(classifyAmoraCrisis(text)).toEqual({ kind: "self_harm" });
    expect(classifyAmoraQuestionScope({ userText: text, requestKind: "chat" }).scope)
      .toBe("W5_safety_override");
    expect(hasAmoraSafetySignal(text, "chat")).toBe(true);
    // 서버(/api/chat/messages)와 같은 호출 — 공유 레인 요청이어도 원문을 저장하지 않는다.
    const server = planAmoraCrisisDelivery({
      userText: text,
      requestedVisibility: "shared",
      target: "ai",
      senderRole: "bride",
      externalSafetySignal: hasAmoraSafetySignal(text, "chat"),
    });
    expect(server).toEqual(expect.objectContaining({
      disposition: "local_safety_hold",
      safetyResolution: "immediate_crisis",
      effectiveVisibility: "bride_private",
      safetyPrivacyRedirected: true,
      classification: { kind: "self_harm" },
    }));
    // 앱 사전 판정 — 호출자 신호 없이도 같은 결론이다.
    const mobile = planAmoraCrisisDelivery({
      userText: text,
      requestedVisibility: "shared",
      target: "ai",
      senderRole: "groom",
    });
    expect(mobile.disposition).toBe("local_safety_hold");
    expect(mobile.effectiveVisibility).toBe("groom_private");
  });
});

describe("(ii) 덧붙이기만 한다 — 이 파일의 모든 행", () => {
  it("행이 400개가 넘는다(변형 포함)", () => {
    expect(EVERY_ROW.length).toBeGreaterThanOrEqual(400);
  });

  it("NEWLY_CAUGHT 밖의 행은 규칙을 뺀 판정과 깊은 동등이다", () => {
    const changed = EVERY_ROW.filter(
      (text) => !NEWLY_CAUGHT_SET.has(text) && !sameAsWithoutRule(text),
    );
    expect(changed).toEqual([]);
  });

  it("규칙을 빼도 무언가를 본 행은 하나도 달라지지 않는다", () => {
    const overridden = EVERY_ROW.filter(
      (text) => assessWithoutRule(text).resolution !== "inconclusive" && !sameAsWithoutRule(text),
    );
    expect(overridden).toEqual([]);
  });

  it("어휘 안의 문장이라도 본문이 이미 잡으면 본문의 판정이 그대로 나간다", () => {
    for (const text of IN_VOCABULARY_BUT_ALREADY_CAUGHT) {
      expect(assessWithoutRule(text).resolution, text).toBe("immediate_crisis");
      expect(assess(text), text).toEqual(assessWithoutRule(text));
    }
  });

  it("계획형 진술 규칙이 잡는 문장은 그 판정이 그대로 나간다", () => {
    for (const text of ["오늘 죽으려고", "나 자살할 거야", "죽을 날짜 정했어"]) {
      expect(assessWithoutRule(text).resolution, text).toBe("immediate_crisis");
      expect(assess(text), text).toEqual(assessWithoutRule(text));
    }
  });
});

describe("(iii) 본인 고백이 아닌 문장 — 부정·남 얘기·물음·웃음·맨 명사·전언·목록 밖 수단", () => {
  it.each(NOT_A_DISCLOSURE)("%s", (text) => {
    expect(assess(text)).toEqual(assessWithoutRule(text));
  });

  it.each(ALREADY_HELD_BY_MAIN)("고백이지만 운영이 이미 즉시 위기로 잡는다 — 규칙은 손대지 않는다: %s", (text) => {
    expect(assess(text)).toEqual(assessWithoutRule(text));
    expect(classifyAmoraCrisis(text)).toEqual({ kind: "self_harm" });
    const server = planAmoraCrisisDelivery({
      userText: text,
      requestedVisibility: "shared",
      target: "ai",
      senderRole: "bride",
      externalSafetySignal: hasAmoraSafetySignal(text, "chat"),
    });
    expect(server.disposition).toBe("local_safety_hold");
  });

  it.each(EVERYDAY)("평범한 문장: %s", (text) => {
    expect(assess(text)).toEqual(assessWithoutRule(text));
  });
});

describe("(v) 체크리스트 답 — 규칙의 낱말만으로 조립한 짐 싸기 말은 위기가 아니다", () => {
  it("반례가 규칙의 낱말을 실제로 쓴다 — `모으다` 활용형이 들어 있고, 서 있는 행과 수단·서술어가 겹친다", () => {
    const gather = /모아 ?(?:뒀|두었|놨|놓았)|모았|모으고 있|모으는 중/u;
    expect(CHECKLIST_ANSWERS.every((text) => gather.test(text))).toBe(true);
    for (const means of ["수면제", "수면유도제", "안정제"]) {
      expect(CHECKLIST_ANSWERS.some((text) => text.includes(means)), means).toBe(true);
      expect(NEWLY_CAUGHT.some((text) => text.includes(means)), means).toBe(true);
    }
  });

  it.each(CHECKLIST_ANSWERS)("%s", (text) => {
    expect(assess(text)).toEqual(assessWithoutRule(text));
    // 서버와 같은 호출 — 원문을 버리고 고정 위기 안내를 내지 않는다.
    const server = planAmoraCrisisDelivery({
      userText: text,
      requestedVisibility: "shared",
      target: "ai",
      senderRole: "bride",
      externalSafetySignal: hasAmoraSafetySignal(text, "chat"),
    });
    expect(server.disposition).not.toBe("local_safety_hold");
    expect(classifyAmoraQuestionScope({ userText: text, requestKind: "chat" }).scope)
      .not.toBe("W5_safety_override");
  });
});

describe("(vi) 알고 남긴 값 — 누출 기록(KNOWN_MISS)은 정상이 아니다", () => {
  // 바라는 동작을 단언한다: 실제 고백은 공유 레인에 남지 않는다. 오늘은 이 단언이 실패한다 —
  // 그래서 `it.fails` 다. 누가 이 문장을 잡으면 빨개진다. 그때 `NEWLY_CAUGHT`·`ALREADY_HELD_BY_MAIN` 으로 옮길 것.
  it.each(KNOWN_MISS)("누출: %s — %s (공유 레인에 남지 않아야 한다)", (text) => {
    const server = planAmoraCrisisDelivery({
      userText: text,
      requestedVisibility: "shared",
      target: "ai",
      senderRole: "bride",
      externalSafetySignal: hasAmoraSafetySignal(text, "chat"),
    });
    expect(server.disposition).not.toBe("continue");
  });

  it("누출 행은 서는 행·고백이 아닌 문장·운영이 잡는 행과 겹치지 않는다", () => {
    const elsewhere = new Set([...NEWLY_CAUGHT, ...NOT_A_DISCLOSURE, ...ALREADY_HELD_BY_MAIN]);
    for (const [text] of KNOWN_MISS) {
      expect(elsewhere.has(text), text).toBe(false);
      // 이 규칙은 서지 않는다(판정이 규칙을 뺀 판정과 같다).
      expect(assess(text), text).toEqual(assessWithoutRule(text));
    }
  });

  it("오탐으로 남긴 행은 규칙이 서는 행이다(어휘 안에서 위험 서술과 모양이 같다)", () => {
    for (const text of KNOWN_COST_FALSE_POSITIVE) {
      expect(NEWLY_CAUGHT_SET.has(text), text).toBe(true);
      expect(assess(text), text).toEqual(IDEATION_VERDICT);
    }
  });
});

describe("(iv) 구조 — 어휘 밖 토큰 하나·웃음·물음표가 규칙을 끈다", () => {
  it.each(RULE_BREAKING_MUTATIONS)("%s — 모든 NEWLY_CAUGHT 행에서 서지 않는다", (_name, mutate) => {
    const stillFires = NEWLY_CAUGHT
      .map(mutate)
      .filter((text) => !sameAsWithoutRule(text));
    expect(stillFires).toEqual([]);
  });

  it.each(RULE_KEEPING_DECORATIONS)("%s — 장식은 판정을 바꾸지 않는다", (_name, decorate) => {
    const lost = NEWLY_CAUGHT
      .map(decorate)
      .filter((text) => !isDeepStrictEqual(assess(text), IDEATION_VERDICT));
    expect(lost).toEqual([]);
  });

  it("두 입구가 같은 판정을 낸다 — 원문을 받는 전달 계획과 정규화본을 받는 위기·범위 분류", () => {
    const diverged = EVERY_ROW.filter((text) => (
      !isDeepStrictEqual(assess(text), assess(normalizeAmoraSafetyText(text)))
    ));
    expect(diverged).toEqual([]);
  });
});
