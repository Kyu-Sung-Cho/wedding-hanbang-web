/**
 * Deterministic, pre-provider guard for clear Korean self-harm or suicide intent.
 *
 * This deliberately returns only a boolean. Callers must not copy the matched
 * phrase into logs or analytics because the source text is highly sensitive.
 */

const CLEARLY_NEGATED_EXPRESSIONS = [
  /(?:이\s*)?(?:집|동네|지역|도시|나라|아파트|숙소|시댁|처가|서울|부산|제주|한국|해외)(?:에서(?:는)?|에는|엔)?\s*(?:계속\s*)?살고\s*싶지\s*(?:않(?:아|아요|다|습니다)|안(?:아|돼))/gu,
  /(?:죽고|죽어\s*버리고|사라지고|없어지고)\s*싶지\s*(?:않(?:아|아요|다|습니다|을\s*거(?:야|예요))|안(?:아|돼|됨))/gu,
  /(?:죽고|죽어\s*버리고|사라지고|없어지고)\s*싶다는?\s*(?:생각|마음|계획|의도)(?:은|이|도)?\s*(?:전혀\s*)?(?:없(?:어|어요|다|습니다)|아니(?:야|에요|다|에요))/gu,
  /(?:죽고|죽어\s*버리고|사라지고|없어지고|자살하고|자해하고)\s*싶(?:은|다는)\s*(?:게|건|것은)\s*아니(?:야|에요|다|에요)/gu,
  /(?:죽을|자살할|자해할)\s*(?:생각|마음|계획|의도)(?:은|이|도)?\s*(?:전혀\s*)?(?:없(?:어|어요|다|습니다)|아니(?:야|에요|다|에요))/gu,
  /(?:자살|자해)\s*(?:하)?지\s*않(?:아|아요|다|습니다|을\s*거(?:야|예요))/gu,
  /살고\s*싶지\s*않은\s*(?:게|건|것은)\s*아니(?:야|에요|다|에요)/gu,
  /["'“”‘’]\s*(?:죽고\s*싶어|살고\s*싶지\s*않아|사라지고\s*싶어|죽어\s*버릴래)\s*["'“”‘’]\s*(?:라는|이란|이라고)\s*(?:말|문장|표현)/gu,
  /(?:죽고\s*싶다는|살고\s*싶지\s*않다는|사라지고\s*싶다는|죽어\s*버릴래라는)\s*(?:말|문장|표현|대사)/gu,
];

const CLEAR_CRISIS_EXPRESSIONS = [
  /(?:^|[\s,.!?…])(?:나는?|내가|저는?|제가)?\s*죽고\s*싶(?:어|어요|다|습니다|네|은\s*생각(?:이)?\s*들어)/u,
  /(?:^|[\s,.!?…])(?:나는?|내가|저는?|제가)?\s*죽어\s*버리(?:고\s*싶(?:어|어요|다)|ㄹ래|겠(?:어|다)|고\s*싶다)/u,
  /(?:^|[\s,.!?…])(?:나는?|내가|저는?|제가)?\s*죽어\s*버릴(?:래|까|거(?:야|예요))/u,
  /(?:^|[\s,.!?…])(?:나는?|내가|저는?|제가)?\s*(?:그냥\s*|차라리\s*)?죽을(?:래|까|거(?:야|예요))/u,
  /(?:^|[\s,.!?…])(?:나는?|내가|저는?|제가)?\s*죽어야겠(?:어|다|어요)/u,
  /차라리\s*죽는\s*(?:게|것이)\s*낫겠(?:어|다|어요)/u,
  /(?:^|[\s,.!?…])(?:나는?|내가|저는?|제가)?\s*살고\s*싶지\s*(?:않(?:아|아요|다|습니다)|안(?:아|돼))/u,
  /(?:^|[\s,.!?…])(?:나는?|내가|저는?|제가)?\s*(?:사라지|없어지)고\s*싶(?:어|어요|다|습니다|네)/u,
  /(?:^|[\s,.!?…])(?:나는?|내가|저는?|제가)?\s*(?:사라져|없어져)\s*버리고\s*싶(?:어|어요|다)/u,
  /(?:^|[\s,.!?…])(?:나는?|내가|저는?|제가)?\s*(?:사라질|없어질)(?:래|까|거(?:야|예요))/u,
  /(?:자살|자해)\s*(?:하고\s*싶(?:어|어요|다|습니다)|할(?:래|까|거(?:야|예요))|해야겠(?:어|다))/u,
  /(?:내|제)\s*(?:목숨|삶)(?:을)?\s*(?:끊|끝내|버리)(?:고\s*싶|ㄹ래|려)/u,
  /(?:내|제)\s*(?:삶|인생)(?:을)?\s*(?:끝내|포기하)(?:고\s*싶|려|겠)/u,
  /목숨(?:을)?\s*끊(?:고\s*싶|을(?:래|까|거(?:야|예요))|어야겠)/u,
  /극단적(?:인)?\s*선택(?:을)?\s*(?:하고\s*싶|할(?:래|까|거(?:야|예요))|해야겠)/u,
  /(?:나|내가|저|제가)\s*.{0,10}\s*죽을\s*(?:거(?:야|예요)|계획(?:이야|이에요|이\s*있어))/u,
  /(?:나|내가|저|제가|내\s*몸|제\s*몸)(?:를|을|은|는)?\s*(?:스스로\s*)?해치(?:고\s*싶|려|려고|겠)/u,
  /(?:자살|죽는|목숨(?:을)?\s*끊는)\s*(?:방법|법)(?:을)?\s*(?:알려|찾아|추천)/u,
  /다시는?\s*깨어나고\s*싶지\s*(?:않(?:아|아요|다)|안(?:아|돼))/u,
];

function normalizeForDetection(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/[_*~`#>|/\\()[\]{}:;\-]+/gu, " ")
    .replace(/죽\s+고/gu, "죽고")
    .replace(/살\s+고/gu, "살고")
    .replace(/싶\s+어/gu, "싶어")
    .replace(/\s+/gu, " ")
    .trim();
}

export function hasImmediateKoreanCrisisSignal(userText: string): boolean {
  if (typeof userText !== "string" || userText.length === 0) return false;

  let candidate = normalizeForDetection(userText);
  for (const pattern of CLEARLY_NEGATED_EXPRESSIONS) {
    candidate = candidate.replace(pattern, " ");
  }
  candidate = candidate.replace(/\s+/gu, " ").trim();
  if (!candidate) return false;

  return CLEAR_CRISIS_EXPRESSIONS.some((pattern) => pattern.test(candidate));
}

/**
 * Fixed Korean response re-verified 2026-07-14 against official help routes:
 * - Ministry of Health and Welfare: https://www.mohw.go.kr/menu.es?mid=a10201010000
 * - Korean National Police: https://www.police.go.kr/www/agency/intro/intro0601.jsp
 * - National Fire Agency: https://nfa.go.kr/nfa/safetyinfo/emergencyservice/119emergencydeclaration
 * 109 (24-hour suicide-prevention counselling), 112 (police), 119 (rescue/EMS).
 * It offers immediate safety steps without diagnosis or a promise of treatment.
 */
export const KOREAN_CRISIS_SAFETY_RESPONSE = `지금 이 말을 혼자 감당하지 않아도 됩니다. 아모라는 응급·의료 서비스를 대신할 수 없지만, 지금 안전을 확보하는 일을 함께 정리할 수 있어요.

본인이나 곁의 사람이 지금 당장 다칠 가능성이 있거나 이미 다쳤다면:
- 혼자 있지 말고 위험한 물건이나 장소에서 떨어져 주세요.
- 가까운 사람에게 “지금 혼자 있으면 위험해요. 같이 있어 주세요.”라고 바로 알려 주세요.
- 한국에서는 112(경찰) 또는 119(구급)에 즉시 연락해 주세요.

지금 당장의 위험은 아니지만 이런 생각이 이어진다면, 24시간 자살예방상담전화 109로 연락할 수 있어요.

가능하면 지금 **“당장 위험해요”** 또는 **“지금은 안전해요”** 중 하나로 답해 주세요.`;
