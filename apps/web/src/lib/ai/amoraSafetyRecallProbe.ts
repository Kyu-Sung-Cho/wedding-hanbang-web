/**
 * 안전망이 무엇을 놓치는지 **세기만** 한다. 동작은 바꾸지 않는다.
 *
 * ## 왜 필요한가
 *
 * `HIGH_RISK_SAFETY_PATTERN` 은 도구·기억만 끄는 것이 아니라 **메시지가 어느
 * 레인에 저장되는지**를 정한다(`/api/chat/messages` → `planAmoraCrisisDelivery`).
 * 목록에 없는 말은 공유 레인에 남고 배우자가 읽는다.
 *
 * 2026-08-25 측정 — 정규식을 보지 않고 상황에서 출발해 쓴 위험 발화 19문장 중
 * **2문장만** 잡혔다(약 10%). 놓친 것에는 탈출 계획이 들어 있다:
 *
 *     "그 사람 몰래 짐 싸서 나가려고 해요"   ← 어떤 어휘 목록으로도 못 잡는다
 *
 * 그런데 같은 날 운영 장부를 세어 보니 사람이 쓴 687건 중 안전 어휘가 든 것이
 * 6건, 넓은 그물에만 걸리는 것이 1건이었다. **비율은 나쁘지만 빈도는 낮다.**
 *
 * 지금 사용자 규모에서 이것은 출시 차단 사유가 아니다. 다만 **놓쳐도 아무도
 * 모른다는 것**이 문제다. 사용자가 100배가 되면 그때 판단할 근거가 있어야 한다.
 *
 * ## 그래서 기록만 한다
 *
 * 이 그물은 재현율만 높으면 되고 정밀도는 필요 없다 — 무엇도 차단하지 않기
 * 때문이다. 오탐은 로그 한 줄이지 사용자 경험이 아니다.
 *
 * **원문은 남기지 않는다.** `CLAUDE.md`: "AI 감사 로그에는 질문·답변·첨부·도구
 * 입력 원문을 복제하지 않는다. 필요한 콘텐츠 비포함 메타데이터만 기록한다."
 * 하물며 이 로그가 담는 것은 가정폭력 서술일 수 있다 — 남길 이유가 더 없다.
 */

/**
 * 넓은 그물. 어휘가 아니라 **상황**으로 묶었다.
 *
 * 좁은 그물(`HIGH_RISK_SAFETY_PATTERN`)이 이미 잡는 것은 여기 없어도 된다.
 * 여기 있는 것은 좁은 그물이 놓쳤던 자리들이다.
 */
const WIDE_NET: ReadonlyArray<readonly [string, RegExp]> = [
  // 가장 위험한 자리. 폭력 낱말이 하나도 없어서 어휘로는 영원히 못 잡는다.
  ["escape_planning", /(?:몰래|들키지\s*않게|말없이)[^.!?\n]{0,20}(?:나가|나올|떠나|짐)|짐\s*(?:을|를)?\s*싸|도망|친정(?:으로|에)\s*(?:가|갈|들어)|벗어나고\s*싶/u],
  ["economic_control", /(?:월급|돈|통장|카드|생활비)[^.!?\n]{0,16}(?:가져가|막아|못\s*쓰게|안\s*줘)|용돈만|제\s*이름으로[^.!?\n]{0,12}대출/u],
  ["movement_control", /(?:친구|가족|부모님)[^.!?\n]{0,16}(?:못\s*만나게|만나지\s*못하게|만나(?:는|지)[^.!?\n]{0,8}못\s*하게)|(?:폰|휴대폰|위치)[^.!?\n]{0,12}(?:검사|확인해|추적)|허락(?:을|를)?\s*받아야/u],
  ["threat", /가만\s*(?:안|두지)|찾아가겠|해코지|후회하게|각오해/u],
  ["physical", /(?:멍이?\s*들|머리채|목을\s*잡|발로\s*차|벽에\s*밀|팔을\s*세게)/u],
  ["sexual", /싫다고\s*했는데|동의\s*없이|원하지\s*않았는데/u],
  ["fear", /무서(?:워|웠|운)|눈치(?:를|가)?\s*보|화(?:를)?\s*낼까\s*봐|불안해서\s*잠/u],
  ["self_harm", /사라지고\s*싶|없어지고\s*싶|살기\s*싫|버티기\s*힘들/u],
] as const;

export type AmoraSafetyRecallObservation = {
  /** 넓은 그물이 걸었는가. */
  wide: boolean;
  /** 좁은 그물(실제로 동작을 바꾸는 쪽)이 걸었는가. */
  narrow: boolean;
  /** 넓은 그물이 붙인 상황 이름. 원문은 담지 않는다. */
  categories: readonly string[];
};

/** 넓은 그물이 어떤 상황으로 보는가. 원문을 돌려주지 않는다. */
export function classifyAmoraSafetyRecallCategories(text: string): string[] {
  if (typeof text !== "string" || text.length === 0) return [];
  const hit: string[] = [];
  for (const [name, pattern] of WIDE_NET) {
    if (pattern.test(text)) hit.push(name);
  }
  return hit;
}

/**
 * 좁은 그물이 놓친 것을 센다.
 *
 * 반환값은 호출부가 무엇을 하라는 뜻이 아니다 — **아무것도 바꾸지 마라.**
 * 이 함수는 로그만 남기고, 그 로그는 나중에 판단할 근거가 된다.
 */
export function observeAmoraSafetyRecall(
  text: string,
  narrowSignal: boolean,
): AmoraSafetyRecallObservation {
  const categories = classifyAmoraSafetyRecallCategories(text);
  const observation: AmoraSafetyRecallObservation = {
    wide: categories.length > 0,
    narrow: narrowSignal,
    categories,
  };
  // 좁은 그물이 이미 잡은 것은 셀 이유가 없다. 미탐만 남긴다.
  if (observation.wide && !observation.narrow) {
    // 원문·커플·사용자는 담지 않는다. 상황 이름과 길이만으로도
    // "얼마나 자주 새는가" 는 셀 수 있다.
    console.warn("[safety-recall] wide net matched, narrow net missed", {
      categories,
      textLength: text.length,
    });
  }
  return observation;
}
