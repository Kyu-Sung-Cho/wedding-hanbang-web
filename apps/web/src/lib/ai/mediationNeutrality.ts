/**
 * 구조화 중재안은 두 사람이 승인하면 공동 결정으로 남는다. 따라서 모델이
 * 한 사람의 인격이나 도덕적 우열을 판정한 문장은 일부를 고쳐 쓰지 않고 카드
 * 전체를 거절한다.
 */

export type MediationNeutralityViolationKind =
  | "demeaning_label"
  | "hidden_motive"
  | "moral_verdict"
  | "one_sided_priority"
  | "unilateral_demand";

// 임의의 짧은 한글 명사구를 사람 이름으로 추측하면 `방법이 맞아요` 같은 사실
// 검증까지 도덕 판정으로 닫힌다. 역할·존칭 이름만 사람 주어로 좁히고,
// 모욕과 일방 요구는 주어 추측 없이 해로운 표현 자체를 검사한다.
const PARTY = "(?:요청자|사용자|신랑|신부|예비\\s*신랑|예비\\s*신부|남편|아내|배우자|파트너|상대(?:방)?|\\p{Script=Hangul}{2,8}\\s*님|(?:^|[^\\p{Script=Hangul}])(?:너|당신)(?:는|은|가|이|의)?(?=$|[^\\p{Script=Hangul}]))";

const ATTRIBUTED_DIRECT_QUOTE_RE =
  /(?:요청자|사용자|신랑|신부|예비\s*신랑|예비\s*신부|남편|아내|배우자|파트너|상대방)(?:는|은|가|이)?\s*(?:직접\s*)?(?:"[^"\n]{1,300}"|“[^”\n]{1,300}”|'[^'\n]{1,300}'|‘[^’\n]{1,300}’)\s*(?:이라고|라고|고)\s*(?:말|전|표현|설명|기록|적|답)(?:했었|했|하|해|었|씀)?(?:어요|습니다|죠|고|으며|다)?/gu;

const DEMEANING_LABEL_RE = new RegExp(
  "(?:이기적|무책임|철없|고집불통|계산적|속물|유치하|한심하|나르시시스트)",
  "u",
);

const MORAL_VERDICT_RE = new RegExp(
  `${PARTY}[^.!?\n]{0,40}(?:옳(?:아요|습니다|다)?|맞(?:아요|습니다|다)|틀렸|잘못(?:했|이에요|입니다|이라고|을\\s*(?:인정|시인|반성))|책임(?:이에요|입니다|이다|이\\s*(?:있|커|크|더\\s*크|전적)|을\\s*(?:져|인정해야|떠안아))|(?:요구|입장|주장|의견|선택|판단)(?:이|가|은|는)?\\s*(?:더|훨씬)\\s*(?:타당|합리적|정당|설득력\\s*있))`,
  "u",
);

const UNILATERAL_DEMAND_RE = new RegExp(
  `[^.!?\n]{0,80}(?:먼저\\s*)?(?:양보|사과|잘못을?\\s*인정|포기|상대(?:의)?\\s*의견을?\\s*따르)[^.!?\n]{0,20}(?:하세요|해야|하십시오|하셔야|해\\s*주세요|하는\\s*(?:게|것이)\\s*(?:좋겠|바람직|필요|낫겠|맞겠))`,
  "u",
);

const NEGATED_UNILATERAL_ASSERTION_RE =
  /[^.!?\n]{0,80}(?:먼저\s*)?(?:양보|사과|잘못을?\s*인정|포기|상대(?:의)?\s*의견을?\s*따르)[^.!?\n]{0,40}(?:단정|판단|요구)하지\s*않(?:아요|습니다|는다)/gu;

const DOUBLE_NEGATIVE_DEMAND_RE =
  /[^.!?\n]{0,80}(?:먼저\s*)?(?:양보|사과|잘못을?\s*인정|포기)[^.!?\n]{0,16}하지\s*않아도\s*된다는\s*(?:뜻|말)[^.!?\n]{0,12}아니/u;

const ONE_SIDED_PRIORITY_RE = new RegExp(
  `(?:${PARTY}[^.!?\n]{0,80}|(?:돈|비용|예산|지출|수입|소득|연봉|경제력|경제적\\s*기여|금전|재정|부담|기여)[^.!?\n]{0,80})(?:(?:의견|입장|요구|선택|판단|제안|말)[^.!?\n]{0,24}(?:우선(?:해야|하세요|하십시오|하셔야|할\\s*(?:필요|권리)|하는\\s*(?:게|것이))|따라야|따르세요|따르는\\s*(?:게|것이))|(?:결정권|최종\\s*결정(?:권)?)[^.!?\n]{0,20}(?:가져야|가져야만|갖(?:게|도록|는)|주어야|줘야|맡겨야|있어야))`,
  "u",
);

const FINANCIAL_DECISION_POWER_RE =
  /(?:수입|소득|연봉|경제력|경제적\s*기여|금전\s*기여|재정\s*기여|비용\s*부담)[^.!?\n]{0,64}(?:높|많|크|더|주된|대부분)[^.!?\n]{0,64}(?:최종\s*)?결정[^.!?\n]{0,20}(?:해야|하세요|하도록|하면\s*(?:돼|됩니다|좋겠))/u;

const AUTHORITY_RELATION_RE =
  /(?:(?:의견|입장|제안|말|선택)(?:을|를|대로|이|가|은|는)[^.!?\n]{0,28}(?:우선(?:해야|하세요|하십시오|하셔야|하는\s*(?:게|것이))|따라야|따르세요|기준(?:으로)?\s*정(?:하면|해야|하세요))|우선(?:해야|하세요|하십시오|하셔야|할)[^.!?\n]{0,28}(?:의견|입장|제안|말|선택)|(?:결정권|선택권)[^.!?\n]{0,48}(?:있어야|주어야|줘야|맡겨야|가져야|갖도록))/u;

const FINANCIAL_POWER_BASIS_RE =
  /(?:(?:돈|비용|지출)[^.!?\n]{0,28}(?:\d{1,3}\s*%|더|많|대부분|전부)[^.!?\n]{0,28}(?:내|부담|기여)|(?:수입|소득|연봉|경제력)[^.!?\n]{0,28}(?:높|낮|많|적|크|작|높은|낮은|많은|적은|큰|작은)|(?:더|많이|대부분|\d{1,3}\s*%)[^.!?\n]{0,20}(?:기여|부담))/u;

const FINANCIAL_AUTHORITY_ACTION_RE =
  /(?:(?:최종\s*)?(?:결정|선택)(?:권)?[^.!?\n]{0,28}(?:하면|해야|있어야|주어야|줘야|맡겨야|가져야)|(?:결정|선택|의견|말|입장|제안)[^.!?\n]{0,28}(?:따라야|우선(?:해야|하세요)|기준(?:으로)?\s*정(?:하면|해야)|정하고)|(?:의견|말|입장|제안)(?:을|를)?\s*정하고)/u;

const STRONG_MUTUAL_PARTY_RE =
  /(?:신랑|예비\s*신랑|남편)\s*(?:과|와|및)\s*(?:신부|예비\s*신부|아내)|(?:신부|예비\s*신부|아내)\s*(?:과|와|및)\s*(?:신랑|예비\s*신랑|남편)|[가-힣]{2,8}(?:님)?\s*(?:과|와|및)\s*[가-힣]{2,8}(?:님)?|두\s*(?:사람|분)|둘\s*다/gu;

const SINGLE_PARTY_AFTER_MUTUAL_RE =
  /(?:요청자|사용자|신랑|신부|예비\s*신랑|예비\s*신부|남편|아내|배우자|파트너|상대(?:방)?|[가-힣]{2,8}님)(?:이|가|은|는|의|에게)?/u;

const DUTY_ACTION_RE = /(?:먼저\s*)?(?:양보|사과|잘못을?\s*인정|포기|상대(?:의)?\s*의견을?\s*따르)/u;
const AUTHORITY_ACTION_RE = /(?:의견|입장|요구|선택|판단|제안|말|결정(?:권)?|선택권)/u;
const ACTION_BOUND_MUTUAL_AUTHORITY_RE =
  /(?:최종\s*)?(?:결정|선택)(?:권)?(?:은|는|을|를|도)?[^.!?\n]{0,12}(?:함께|공동으로|둘이|두\s*(?:사람|분)이)[^.!?\n]{0,12}(?:해야|하세요|정해야|정하세요|하면|하도록)/u;

function hasStrongMutualActorScope(text: string, actionRe: RegExp): boolean {
  const action = actionRe.exec(text);
  if (!action || action.index === undefined) return false;
  const prefix = text.slice(0, action.index);
  const mutualActors = [...prefix.matchAll(STRONG_MUTUAL_PARTY_RE)];
  const lastMutual = mutualActors.at(-1);
  if (!lastMutual || lastMutual.index === undefined) return false;
  const afterMutual = prefix.slice(lastMutual.index + lastMutual[0].length);
  return !SINGLE_PARTY_AFTER_MUTUAL_RE.test(afterMutual);
}

function hasMutualDutyScope(text: string): boolean {
  return hasStrongMutualActorScope(text, DUTY_ACTION_RE);
}

function hasMutualAuthorityScope(text: string): boolean {
  return ACTION_BOUND_MUTUAL_AUTHORITY_RE.test(text)
    || hasStrongMutualActorScope(text, AUTHORITY_ACTION_RE);
}

const HIDDEN_MOTIVE_RE = new RegExp(
  `(?:일부러|(?:통제|조종|상처\\s*주|벌\\s*주|무시|책임을?\\s*피하|결혼을?\\s*피하)[^.!?\n]{0,8}(?:려고|기\\s*위해)|사랑하지\\s*않아서|속마음은|진짜\\s*의도는)`,
  "u",
);

function findViolationsInAnalyzableText(
  analyzableText: string,
): MediationNeutralityViolationKind[] {
  const violations: MediationNeutralityViolationKind[] = [];
  if (DEMEANING_LABEL_RE.test(analyzableText)) violations.push("demeaning_label");
  if (HIDDEN_MOTIVE_RE.test(analyzableText)) violations.push("hidden_motive");
  if (MORAL_VERDICT_RE.test(analyzableText)) violations.push("moral_verdict");
  const demandAnalyzableText = analyzableText.replace(
    NEGATED_UNILATERAL_ASSERTION_RE,
    "일방 의무를 단정하지 않음",
  );
  const unilateralDemand = UNILATERAL_DEMAND_RE.exec(demandAnalyzableText)
    ?? DOUBLE_NEGATIVE_DEMAND_RE.exec(analyzableText);
  if (unilateralDemand && !hasMutualDutyScope(unilateralDemand[0])) {
    violations.push("unilateral_demand");
  }
  const oneSidedPriority = ONE_SIDED_PRIORITY_RE.exec(analyzableText)
    ?? FINANCIAL_DECISION_POWER_RE.exec(analyzableText)
    ?? AUTHORITY_RELATION_RE.exec(analyzableText);
  if (oneSidedPriority && !hasMutualAuthorityScope(oneSidedPriority[0])) {
    violations.push("one_sided_priority");
  }
  if (
    !violations.includes("one_sided_priority")
    && FINANCIAL_POWER_BASIS_RE.test(analyzableText)
    && FINANCIAL_AUTHORITY_ACTION_RE.test(analyzableText)
    && !hasMutualAuthorityScope(analyzableText)
  ) {
    violations.push("one_sided_priority");
  }
  return violations;
}

export function findMediationNeutralityViolations(
  text: string,
): MediationNeutralityViolationKind[] {
  if (typeof text !== "string" || !text.trim()) return [];

  // 사실·선호를 옮긴 중립 인용은 아모라의 판정으로 오인하지 않는다. 다만 모욕,
  // 잘잘못 판정, 일방 요구·우선권은 출처를 붙여도 공유 카드에서 다시 전달하지 않는다.
  const analyzableText = text.replace(
    ATTRIBUTED_DIRECT_QUOTE_RE,
    (quote) => findViolationsInAnalyzableText(quote).length > 0
      ? quote
      : "당사자 직접 인용",
  );

  return findViolationsInAnalyzableText(analyzableText);
}
