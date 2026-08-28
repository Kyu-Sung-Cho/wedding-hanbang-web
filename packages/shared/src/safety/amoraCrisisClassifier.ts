// Browser, native, and server must classify the same canonical disclosure.
export type AmoraCrisisKind =
  | "self_harm"
  | "third_party_self_harm"
  | "interpersonal_danger"
  | "interpersonal_danger_reporter_aggressor"
  | "multi_party_self_harm"
  | "combined_interpersonal_self_harm"
  | "combined_reporter_aggressor_self_harm"
  | "combined_reporter_aggressor_third_party_self_harm"
  | "combined_reporter_aggressor_multi_party_self_harm";

export type AmoraSafetyActor = "self" | "known_other" | "unknown";
export type AmoraSafetyTarget = "self" | "reporter" | "known_other" | "unknown";
export type AmoraSafetyDirection =
  | "self_directed"
  | "toward_reporter"
  | "reporter_toward_other"
  | "third_party"
  | "unknown";
export type AmoraSafetyAction =
  | "self_harm_intent"
  | "self_harm_attempt"
  | "lethal_threat"
  | "physical_violence"
  | "sexual_violence"
  | "coercive_control"
  | "stalking"
  | "weapon_threat";
export type AmoraSafetyTemporality =
  | "current"
  | "impending"
  | "past"
  | "hypothetical";
export type AmoraSafetyPolarity = "affirmed" | "negated" | "safe_now";
export type AmoraSafetyContext = "disclosure" | "meta" | "fiction_news";

export interface AmoraSafetyEvent {
  actor: AmoraSafetyActor;
  target: AmoraSafetyTarget;
  direction: AmoraSafetyDirection;
  action: AmoraSafetyAction;
  temporality: AmoraSafetyTemporality;
  polarity: AmoraSafetyPolarity;
  context: AmoraSafetyContext;
}

export interface AmoraSafetyAssessment {
  resolution:
    | "immediate_crisis"
    | "non_immediate_safety"
    | "no_safety_signal"
    | "inconclusive";
  kind: AmoraCrisisKind | null;
  responseDirection:
    | "toward_reporter"
    | "reporter_toward_other"
    | "third_party"
    | "mixed"
    | null;
  events: readonly AmoraSafetyEvent[];
}

export function normalizeAmoraSafetyText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\p{Cf}\u034F\u180B-\u180F\uFE00-\uFE0F]/gu, "")
    .replace(
      /죽\s*(?:\.{2,}|…+)\s*고(?=\s*(?:만\s*)?(?:(?:\.{2,}|…+)\s*)?싶)/g,
      "죽고",
    )
    .replace(
      /죽고(만)?\s*(?:\.{2,}|…+)\s*(?=싶)/g,
      (_match, modifier: string | undefined) => `죽고${modifier ?? ""} `,
    )
    .replace(/[^\S\r\n]+/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/ *\n+ */g, "\n")
    .trim();
}

const PARTNER_PATTERN =
  /(?:예비\s*신랑|예비\s*신부|남친|여친|파트너|상대방|그\s*사람|배우자|남편|아내|남자친구|여자친구|신랑|신부|상대)/;
const KNOWN_OTHER_PATTERN =
  /(?:친구|지인|동생|형|누나|언니|오빠|엄마|아빠|부모님|예비\s*신랑|예비\s*신부|남친|여친|파트너|상대방|그\s*사람|배우자|남편|아내|남자친구|여자친구|신랑|신부|상대)/;
const REPORTER_TARGET_PATTERN = /(?:나|저|날|절)(?:를)?/;
// 1인칭 주어. **뒤에 한글이 더 오면 대명사가 아니라 다른 낱말의 첫 음절이다.**
//
// 경계가 없던 동안 `나`가 `나오`·`나가`·`나중`·`나머지`·`나이`·`나눠`의 첫 음절에,
// `저`가 `저녁`·`저번`·`저희`·`저쪽`에, `전`이 `전화`·`전부`·`전세`·`전날`에,
// `난`이 `난방`에 걸렸다. 이 자리는 아래에서 `.{0,32}` 뒤의 `죽겠`와 묶여 자해
// 진술이 되므로, "예단 얘기만 나오면 답답해 죽겠음" 이 자해 위기로 판정됐다.
//
// 그 판정의 대가는 경고 한 줄이 아니다 — `planAmoraCrisisDelivery`가
// `local_safety_hold`를 내면 원문이 DB에 저장되지 않고 작성창도 복구 없이 비워져
// **사용자가 쓴 글이 사라진다.** 겨냥해 만든 평범한 문장 15개가 15개 모두 걸렸다
// ("드레스 나오는 날만 기다려서 설레 죽겠어" 포함).
//
// 낱말을 하나씩 제외하지 않는다 — `나`로 시작하는 한국어 낱말에는 끝이 없다.
// 대신 **조사를 달거나 경계에서 끝나야 한다**는 형태 규칙으로 막는다.
const REPORTER_ACTOR_PATTERN =
  /(?:(?:나|저)(?:는|도|만|까지|조차|한테|에게|보다|부터|마저|랑|와|처럼|의|를|야)?|난|전|(?:내|제)(?:가|게|한테))(?![가-힣])/;
const EXPLICIT_REPORTER_ACTOR_PATTERN =
  /(?:^|[\s,.;!?])(?:나는|내가|나도|난|나|저는|제가|저도|전|저)(?=$|[\s,.;!?])/;
const EXPLICIT_KNOWN_OTHER_ACTOR_PATTERN = new RegExp(
  `(?:^|[\\s,.;!?])${KNOWN_OTHER_PATTERN.source}(?:가|이|는|은|도)?(?=$|[\\s,.;!?])`,
);
const HISTORICAL_MARKER_PATTERN = /(?:예전에|과거에|작년에|몇\s*년\s*전|오래전에|그때)/;
const VIOLENCE_CUE_PATTERN =
  /(?:죽이겠|죽인다고|죽여\s*버리|때리|맞았|폭력|폭행|칼로?\s*협박|협박|위협|감금|가둬|성폭행|성폭력|성추행|강간|동의\s*없이|목을?\s*조르)/;
const RESUMED_CURRENT_VIOLENCE_PATTERN =
  /(?:하지만|그런데|근데|지만).{0,24}(?:지금|현재|방금|오늘).{0,32}(?:또\s*)?(?:때리|때려|맞고|폭행|협박|위협|감금|가둬|죽이|성폭행|성폭력|성추행|강간|목을?\s*조르)/;
const HYPOTHETICAL_SAFETY_PATTERN =
  /(?:(?:죽이겠다고|죽인다고|때리겠다고|협박한다고|위협한다고|죽\s*고\s*싶다고|자살한다고|자해한다고).{0,16}(?:하면|한다면|말하면|경우)|(?:때릴|죽일|해칠)까\s*봐)/;
const BENIGN_DELIVERY_TRACKING_PATTERN =
  /(?:배송|택배)\s*기사.{0,40}(?:내\s*)?위치(?:를|을)?\s*추적.{0,40}(?:집|문)\s*앞.{0,24}기다리/;
const BENIGN_CAKE_KNIFE_PATTERN =
  /(?:(?:케이크|케익).{0,28}(?:칼|나이프)|(?:칼|나이프).{0,28}(?:케이크|케익)).{0,40}(?:사진|커팅|자르|촬영)/;
const BENIGN_IDIOM_PATTERN =
  /(?:드레스\s*투어|결혼\s*준비|예식\s*준비|친구가\s*웃겨|웃겨서|너무\s*(?:힘들|피곤|바빠)).{0,40}(?:죽을\s*것\s*같|죽겠)/;
const FICTION_NEWS_CONTEXT_PATTERN =
  /(?:(?:영화|소설|드라마|게임|뉴스|기사).{0,100}(?:장면|대사|사건|보도|읽었|분석|검토|주인공|등장인물)|(?:영화|소설|드라마)(?:에서|속에서).{0,80}(?:죽\s*고\s*싶|죽이겠|자살|자해|폭행|협박|위협))/;
const META_CONTEXT_PATTERN =
  /(?:(?:문구|표현|단어|대사|가사|예시|캠페인|예방\s*교육).{0,100}(?:검토|작성|추천|분석|가정(?:해|하면|한))|(?:검토|작성|추천|분석|가정(?:해|하면|한)).{0,100}(?:문구|표현|단어|대사|가사|예시|캠페인|예방\s*교육))/;
const FICTIONAL_GAME_CONTEXT_PATTERN = /게임(?:에서|중에|속에서)/;
const CURRENT_DISCLOSURE_OVERRIDE_PATTERN =
  /(?:(?:아니라|그런데|근데|하지만).{0,40}(?:나|저|남편|아내|배우자|남친|여친|신랑|신부|상대).{0,40}(?:진짜|지금|현재|오늘|방금).{0,40}(?:죽\s*고\s*싶|자살|자해|때리|맞고|협박|위협|칼|흉기)|(?:오늘|지금|현재|방금).{0,50}(?:때리|맞고|폭행|협박|위협|죽\s*고\s*싶|자살|자해|칼|흉기))/;
const CONCRETE_SELF_HARM_ATTEMPT_PATTERN =
  /(?:(?:졸피뎀|수면제|진통제|타이레놀|아세트아미노펜|약|알약)(?:을|를)?\s*(?:(?:[1-9]\d+)\s*(?:알|개)|한\s*(?:통|병)|여러\s*알|전부|모두|다|몽땅|너무\s*많이|많이|과다|과량|한꺼번에|왕창|잔뜩|한\s*(?:움큼|줌))(?:을|를)?\s*(?:먹|삼키|삼켰|복용)|(?:옥상|난간|다리|베란다|한강).{0,36}(?:뛰어내리|몸을?\s*던지)(?:려고|려는|려|겠|ㄹ)|(?:뛰어내리|몸을?\s*던지)(?:려고|려는|려).{0,36}(?:옥상|난간|다리|베란다|한강)|(?:농약|락스|표백제|세제|부동액)(?:을|를)?\s*(?:마시|마셨|먹|삼키)|(?:번개탄|연탄)(?:을|를)?\s*(?:피우|피웠|피워|점화|켜))/;
const ATTEMPT_NEGATION_PATTERN =
  /(?:먹|삼키|삼켰|복용|마시|마셨|피우|피웠|피워|점화|켜|뛰어내리|몸을?\s*던지).{0,60}(?:지\s*않|은\s*(?:건|것은)\s*아니|려는\s*(?:건|것은)\s*아니|려고.{0,40}(?:한|있는)\s*(?:건|것은)\s*아니)/;
const ATTEMPT_HYPOTHETICAL_PATTERN =
  /(?:먹|삼키|복용|마시|마셨|피우|피웠|피워(?:놓)?|점화|켜|뛰어내리|몸을?\s*던지).{0,12}(?:면|다면|경우)/;
const NEGATED_INTERPERSONAL_EVENT_PATTERN =
  /(?:(?:협박|위협|때리|폭행|감금|가둬|가뒀|가둔|가두|죽일\s*거|죽인대|죽인다는|목을?\s*조르|칼|흉기).{0,20}(?:한|했던|하고\s*있는|들고\s*있는|라는|다는)?\s*(?:건|게|것은)\s*아니|(?:협박|위협|때리|폭행|감금|가두|목을?\s*조르)지\s*않)/;
const EXPLICIT_SAFETY_CLAUSE_BOUNDARY_SOURCE = "[\\n.!?;]+";
const SAFETY_CLAUSE_BOUNDARY_PATTERN = new RegExp(
  `(?:${EXPLICIT_SAFETY_CLAUSE_BOUNDARY_SOURCE}|하지만|그런데|근데|지만|(?<=[았었였했겠])는데|(?<=[았었였했])고(?=\\s*(?:나는|내가|나도|저는|제가|저도|${KNOWN_OTHER_PATTERN.source}(?:가|이|는|은|도))\\s)|,\\s*(?=(?:나는|내가|나도|저는|제가|저도|${KNOWN_OTHER_PATTERN.source}(?:가|이|는|은|도)|지금|현재|방금|오늘)\\s))`,
);
const ELIDED_INGESTION_CONTINUATION_PATTERN = new RegExp(
  `^(?:나는|내가|나도|저는|제가|저도|${KNOWN_OTHER_PATTERN.source}(?:가|이|는|은|도))\\s*(?:먹었(?:어|어요|다)?|먹지\\s*않았(?:어|어요|다)?|삼켰(?:어|어요|다)?|삼키지\\s*않았(?:어|어요|다)?|복용했(?:어|어요|다)?|복용하지\\s*않았(?:어|어요|다)?)[.!?]?$`,
);
const INDEPENDENT_IMMEDIATE_SAFETY_CUE_PATTERN =
  /(?:죽\s*고\s*싶|자살|자해|목숨을?\s*끊|칼|흉기|때리|맞고|폭행|협박|위협|감금|가둬|성폭행|성폭력|성추행|강간|목을?\s*조르|수면제|졸피뎀|농약|락스|표백제|번개탄|연탄)/;
const UNAMBIGUOUS_SELF_HARM_IDEATION_PATTERN =
  /(?:(?:더는\s*)?못\s*살겠(?:어|다|어요)?|차라리\s*죽는\s*게\s*나아|이제\s*그만\s*살래)(?=$|[.!?])/;

function splitAmoraSafetyClauses(text: string): string[] {
  return text
    .split(SAFETY_CLAUSE_BOUNDARY_PATTERN)
    .map((clause) => clause.trim())
    .filter(Boolean);
}

function hasIndependentImmediateSafetyClause(text: string): boolean {
  return splitAmoraSafetyClauses(text).some((clause) => {
    if (
      BENIGN_DELIVERY_TRACKING_PATTERN.test(clause)
      || BENIGN_CAKE_KNIFE_PATTERN.test(clause)
      || BENIGN_IDIOM_PATTERN.test(clause)
    ) {
      return false;
    }
    return INDEPENDENT_IMMEDIATE_SAFETY_CUE_PATTERN.test(clause);
  });
}

function hasIndependentCurrentDisclosureClause(text: string): boolean {
  const hasWholeMessageContext =
    FICTION_NEWS_CONTEXT_PATTERN.test(text)
    || META_CONTEXT_PATTERN.test(text)
    || FICTIONAL_GAME_CONTEXT_PATTERN.test(text);
  const explicitRealWorldTransitionPattern = new RegExp(
    `(?:그런데|근데|하지만|(?:했|였|았|었|겠)는데|${EXPLICIT_SAFETY_CLAUSE_BOUNDARY_SOURCE})\\s*.{0,64}(?:오늘|지금|현재|방금|진짜).{0,48}(?:죽\\s*고\\s*싶|자살|자해|때리|맞고|폭행|협박|위협|칼|흉기)`,
  );
  const hasExplicitRealWorldTransition =
    explicitRealWorldTransitionPattern.test(text);
  if (hasWholeMessageContext && !hasExplicitRealWorldTransition) {
    return false;
  }
  return splitAmoraSafetyClauses(text).some((clause) => {
    if (
      FICTION_NEWS_CONTEXT_PATTERN.test(clause)
      || META_CONTEXT_PATTERN.test(clause)
      || FICTIONAL_GAME_CONTEXT_PATTERN.test(clause)
    ) {
      return false;
    }
    return CURRENT_DISCLOSURE_OVERRIDE_PATTERN.test(clause);
  });
}

function lastPatternIndex(pattern: RegExp, value: string): number {
  let lastIndex = -1;
  const globalPattern = new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`);
  for (const match of value.matchAll(globalPattern)) {
    lastIndex = match.index;
  }
  return lastIndex;
}

function inferConcreteAttemptActor(clause: string): AmoraSafetyActor {
  const attemptIndex = clause.search(CONCRETE_SELF_HARM_ATTEMPT_PATTERN);
  const actorContext = attemptIndex >= 0 ? clause.slice(0, attemptIndex) : clause;
  const reporterIndex = lastPatternIndex(
    EXPLICIT_REPORTER_ACTOR_PATTERN,
    actorContext,
  );
  const knownOtherIndex = lastPatternIndex(
    EXPLICIT_KNOWN_OTHER_ACTOR_PATTERN,
    actorContext,
  );

  if (reporterIndex >= knownOtherIndex && reporterIndex >= 0) return "self";
  if (knownOtherIndex >= 0) return "known_other";
  return "self";
}

function applyAdjacentIngestionEllipsis(
  clauses: readonly string[],
  assessments: readonly AmoraSafetyAssessment[],
): AmoraSafetyAssessment[] {
  return assessments.map((assessment, index) => {
    const clause = clauses[index];
    const previousClause = clauses[index - 1];
    if (
      index === 0
      || !clause
      || !previousClause
      || !CONCRETE_SELF_HARM_ATTEMPT_PATTERN.test(previousClause)
      || CONCRETE_SELF_HARM_ATTEMPT_PATTERN.test(clause)
      || !ELIDED_INGESTION_CONTINUATION_PATTERN.test(clause)
    ) {
      return assessment;
    }

    const actor = inferConcreteAttemptActor(clause);
    const polarity: AmoraSafetyPolarity = ATTEMPT_NEGATION_PATTERN.test(clause)
      ? "negated"
      : "affirmed";
    return {
      resolution: polarity === "affirmed"
        ? "immediate_crisis"
        : "no_safety_signal",
      kind: polarity === "affirmed"
        ? actor === "known_other"
          ? "third_party_self_harm"
          : "self_harm"
        : null,
      responseDirection: polarity === "affirmed" && actor === "known_other"
        ? "third_party"
        : null,
      events: [
        {
          actor,
          target: "self",
          direction: "self_directed",
          action: "self_harm_attempt",
          temporality: "current",
          polarity,
          context: "disclosure",
        },
      ],
    };
  });
}

function combineImmediateClauseAssessments(
  assessments: readonly AmoraSafetyAssessment[],
): AmoraSafetyAssessment | null {
  const immediate = assessments.filter(
    (assessment) => assessment.resolution === "immediate_crisis",
  );
  if (immediate.length === 0) return null;

  const events = assessments.flatMap((assessment) => assessment.events);
  const activeEvents = events.filter(
    (event) =>
      event.polarity === "affirmed"
      && (event.temporality === "current" || event.temporality === "impending"),
  );
  const hasReporterSelfHarm = activeEvents.some(
    (event) =>
      event.actor === "self"
      && event.direction === "self_directed"
      && (event.action === "self_harm_intent" || event.action === "self_harm_attempt"),
  );
  const hasThirdPartySelfHarm = activeEvents.some(
    (event) =>
      event.actor === "known_other"
      && event.direction === "self_directed"
      && (event.action === "self_harm_intent" || event.action === "self_harm_attempt"),
  );
  const hasReporterAggression = activeEvents.some(
    (event) => event.direction === "reporter_toward_other",
  );
  const hasDangerTowardReporter = activeEvents.some(
    (event) =>
      event.direction === "toward_reporter"
      && event.action !== "self_harm_intent"
      && event.action !== "self_harm_attempt",
  );

  let kind: AmoraCrisisKind;
  let responseDirection: AmoraSafetyAssessment["responseDirection"];
  if (
    hasReporterAggression
    && hasReporterSelfHarm
    && hasThirdPartySelfHarm
  ) {
    kind = "combined_reporter_aggressor_multi_party_self_harm";
    responseDirection = "mixed";
  } else if (hasReporterAggression && hasThirdPartySelfHarm) {
    kind = "combined_reporter_aggressor_third_party_self_harm";
    responseDirection = "reporter_toward_other";
  } else if (hasReporterAggression && hasReporterSelfHarm) {
    kind = "combined_reporter_aggressor_self_harm";
    responseDirection = "reporter_toward_other";
  } else if (hasReporterAggression) {
    kind = "interpersonal_danger_reporter_aggressor";
    responseDirection = "reporter_toward_other";
  } else if (
    hasDangerTowardReporter
    && (hasReporterSelfHarm || hasThirdPartySelfHarm)
  ) {
    kind = "combined_interpersonal_self_harm";
    responseDirection = "toward_reporter";
  } else if (hasDangerTowardReporter) {
    kind = "interpersonal_danger";
    responseDirection = "toward_reporter";
  } else if (hasReporterSelfHarm && hasThirdPartySelfHarm) {
    kind = "multi_party_self_harm";
    responseDirection = "mixed";
  } else if (hasThirdPartySelfHarm) {
    kind = "third_party_self_harm";
    responseDirection = "third_party";
  } else if (hasReporterSelfHarm) {
    kind = "self_harm";
    responseDirection = null;
  } else {
    const first = immediate[0];
    if (!first?.kind) return null;
    kind = first.kind;
    responseDirection = first.responseDirection;
  }

  return {
    resolution: "immediate_crisis",
    kind,
    responseDirection,
    events,
  };
}

export function assessAmoraSafetyText(value: string): AmoraSafetyAssessment {
  const text = normalizeAmoraSafetyText(value);
  const clauses = splitAmoraSafetyClauses(text);
  const hasIndependentCurrentDisclosure =
    hasIndependentCurrentDisclosureClause(text);
  if (
    (
      BENIGN_DELIVERY_TRACKING_PATTERN.test(text)
      || BENIGN_CAKE_KNIFE_PATTERN.test(text)
      || BENIGN_IDIOM_PATTERN.test(text)
    )
    && !hasIndependentImmediateSafetyClause(text)
  ) {
    return {
      resolution: "no_safety_signal",
      kind: null,
      responseDirection: null,
      events: [],
    };
  }
  if (
    FICTIONAL_GAME_CONTEXT_PATTERN.test(text)
    && !hasIndependentCurrentDisclosure
  ) {
    return {
      resolution: "no_safety_signal",
      kind: null,
      responseDirection: null,
      events: [],
    };
  }
  if (
    (FICTION_NEWS_CONTEXT_PATTERN.test(text) || META_CONTEXT_PATTERN.test(text))
    && !hasIndependentCurrentDisclosure
  ) {
    const fictionNews = FICTION_NEWS_CONTEXT_PATTERN.test(text);
    const selfDirected = /죽\s*고\s*싶|자살|자해/.test(text);
    return {
      resolution: "no_safety_signal",
      kind: null,
      responseDirection: null,
      events: [
        {
          actor: KNOWN_OTHER_PATTERN.test(text) ? "known_other" : "unknown",
          target: selfDirected ? "self" : "known_other",
          direction: selfDirected ? "self_directed" : "third_party",
          action: selfDirected ? "self_harm_intent" : "lethal_threat",
          temporality: "hypothetical",
          polarity: "affirmed",
          context: fictionNews ? "fiction_news" : "meta",
        },
      ],
    };
  }
  if (clauses.length > 1) {
    const clauseAssessments = applyAdjacentIngestionEllipsis(
      clauses,
      clauses.map((clause) => assessAmoraSafetyText(clause)),
    );
    const combinedImmediateAssessment = combineImmediateClauseAssessments(
      clauseAssessments,
    );
    if (combinedImmediateAssessment) return combinedImmediateAssessment;
  }
  if (NEGATED_INTERPERSONAL_EVENT_PATTERN.test(text)) {
    return {
      resolution: "no_safety_signal",
      kind: null,
      responseDirection: null,
      events: [
        {
          actor: KNOWN_OTHER_PATTERN.test(text) ? "known_other" : "unknown",
          target: "reporter",
          direction: "toward_reporter",
          action: /협박|위협|감금|가둬/.test(text)
            ? "coercive_control"
            : /칼|흉기/.test(text)
              ? "weapon_threat"
              : "physical_violence",
          temporality: "current",
          polarity: "negated",
          context: "disclosure",
        },
      ],
    };
  }
  const partnerThreat = new RegExp(
    `${PARTNER_PATTERN.source}(?:가|이|는|은)?\\s*.{0,36}${REPORTER_TARGET_PATTERN.source}\\s*.{0,16}(?:죽이겠다고|죽인다고|죽인대|죽일\\s*(?:거|거야)|죽여\\s*버리겠다고|죽이려고)`,
  );
  const partnerSelfHarm = new RegExp(
    `${PARTNER_PATTERN.source}(?:가|이|는|은)?\\s*.{0,36}(?:자기(?:가|는|도)?\\s*)?(?:죽겠다고|죽겠대|죽\\s*고\\s*싶다고|자살(?:하겠다고|하려고)|자해(?:하겠다고|하려고))`,
  );
  const negatedPartnerThreat = new RegExp(
    `${PARTNER_PATTERN.source}(?:가|이|는|은)?\\s*.{0,32}${REPORTER_TARGET_PATTERN.source}\\s*.{0,16}(?:죽이겠다고|죽인다고|죽여\\s*버리겠다고).{0,16}(?:한|말한|했던)\\s*(?:건|게|것은)\\s*아니(?!라)`,
  );
  const negatedPartnerSelfHarm = new RegExp(
    `${PARTNER_PATTERN.source}(?:가|이|는|은)?\\s*.{0,32}(?:자기(?:가|는|도)?\\s*)?(?:죽겠다고|죽겠대|죽\\s*고\\s*싶다고|자살(?:하겠다고|하려고)|자해(?:하겠다고|하려고)).{0,16}(?:한|말한|했던)?\\s*(?:건|게|것은)\\s*아니(?!라)`,
  );
  const partnerMurderSuicide = new RegExp(
    `${PARTNER_PATTERN.source}(?:가|이|는|은)?\\s*.{0,36}${REPORTER_TARGET_PATTERN.source}\\s*.{0,16}(?:죽이고|해치고).{0,24}(?:자기(?:도|가)?|본인도)\\s*죽겠(?:대|다고)`,
  );
  const deniedPartnerThreatThenSelfHarm = new RegExp(
    `${PARTNER_PATTERN.source}(?:가|이|는|은)?\\s*.{0,28}${REPORTER_TARGET_PATTERN.source}\\s*.{0,12}(?:죽이겠다고|죽인다고).{0,12}(?:한|말한)\\s*(?:게|건|것은)\\s*아니라.{0,24}(?:자기(?:가|는|도)?|본인(?:이|은|도)?)\\s*죽겠(?:다고|대)`,
  );
  const deniedPartnerSelfHarmThenThreat = new RegExp(
    `${PARTNER_PATTERN.source}(?:가|이|는|은)?\\s*.{0,28}(?:자기(?:가|는|도)?|본인(?:이|은|도)?)\\s*죽겠(?:다고|대).{0,12}(?:한|말한)\\s*(?:게|건|것은)\\s*아니라.{0,24}${REPORTER_TARGET_PATTERN.source}\\s*.{0,12}(?:죽이겠다고|죽인다고)`,
  );
  const knownOtherSelfHarm = new RegExp(
    `${KNOWN_OTHER_PATTERN.source}(?:가|이|는|은|도)?\\s*.{0,48}(?:죽\\s*고\\s*싶다고|죽겠다고|죽겠대|자살(?:하겠다고|하려고)|자해(?:하겠다고|하려고)|그만\\s*살고\\s*싶다고|사라지고\\s*싶다고)`,
  );
  const reporterSelfHarm = new RegExp(
    `(?:${REPORTER_ACTOR_PATTERN.source}\\s*.{0,32}(?:죽\\s*고\\s*싶|죽겠|죽을\\s*(?:래|거)|자살|자해|목숨을?\\s*끊|그만\\s*살고\\s*싶|사라지고\\s*싶)|${UNAMBIGUOUS_SELF_HARM_IDEATION_PATTERN.source})`,
  );
  const negatedReporterSelfHarm = new RegExp(
    `${REPORTER_ACTOR_PATTERN.source}\\s*.{0,28}(?:죽\\s*고\\s*싶지\\s*않|죽\\s*고\\s*싶은\\s*(?:건|것은)\\s*아니|자살(?:하고)?\\s*싶지\\s*않|자해(?:하고)?\\s*싶지\\s*않|자살하지\\s*않|자해하지\\s*않)`,
  );
  const reporterAggression = new RegExp(
    `${REPORTER_ACTOR_PATTERN.source}\\s*.{0,20}(?:지금|당장)?\\s*.{0,24}${PARTNER_PATTERN.source}(?:을|를)?\\s*.{0,20}(?:죽이러\\s*(?:가|갈)|죽여\\s*버리|죽일\\s*(?:거|래)|해치러\\s*(?:가|갈)|때리(?:고\\s*있|는\\s*중)|목(?:을)?\\s*조르(?:고\\s*있|는\\s*중))`,
  );
  const implicitReporterAggression = new RegExp(
    `(?:^|[\\s,.!?])${PARTNER_PATTERN.source}(?:을|를)?\\s*(?:죽여\\s*버릴|죽일|해칠)\\s*(?:거야|거예요|겁니다|래)`,
  );
  const reporterWeaponApproach = new RegExp(
    `(?:칼|흉기)(?:을|를)?\\s*들고\\s*.{0,24}${PARTNER_PATTERN.source}(?:을|를)?\\s*(?:찾아(?:가|갈)|찾으러\\s*(?:가|갈))`,
  );
  const reporterWeaponSwing = new RegExp(
    `${PARTNER_PATTERN.source}(?:에게|한테)\\s*(?:칼|흉기)(?:을|를)?\\s*휘두(?:를|르고|른)`,
  );
  const reporterAggressionAndSelfHarm = new RegExp(
    `${REPORTER_ACTOR_PATTERN.source}\\s*.{0,20}${PARTNER_PATTERN.source}(?:을|를)?\\s*(?:죽이고|해치고).{0,24}${REPORTER_ACTOR_PATTERN.source}\\s*(?:죽을|죽겠|자살|자해)`,
  );
  const reporterReportsKnownOtherSelfHarm = new RegExp(
    `(?:^|[\\s,.!?])${REPORTER_ACTOR_PATTERN.source}\\s*[^\\n.!?]{0,20}${KNOWN_OTHER_PATTERN.source}(?:가|이|는|은|도)\\s*[^\\n.!?]{0,48}(?:죽\\s*고\\s*싶다고|죽겠다고|죽겠대|그만\\s*살고\\s*싶다고|사라지고\\s*싶다고|자살|자해)`,
  );
  const knownOtherReportsReporterSelfHarm = new RegExp(
    `(?:^|[\\s,.!?])${KNOWN_OTHER_PATTERN.source}(?:가|이|는|은|도)\\s*[^\\n.!?]{0,20}${REPORTER_ACTOR_PATTERN.source}\\s*[^\\n.!?]{0,40}(?:죽\\s*고\\s*싶|죽겠|그만\\s*살고\\s*싶|사라지고\\s*싶|자살|자해)`,
  );
  const otherInterpersonalDanger = new RegExp(
    `${PARTNER_PATTERN.source}(?:가|이|는|은)?\\s*.{0,48}(?:(?:칼|흉기).{0,24}(?:협박|위협|들고)|(?:협박|위협|때리|폭행|감금|가둬|가뒀|가둔|가두)|(?:휴대폰|전화기).{0,20}뺏.{0,24}(?:집|방|차).{0,12}(?:가둬|가뒀|가둔)|(?:집|문)\\s*앞.{0,28}기다리.{0,28}(?:계속\\s*)?(?:따라오|따라와|쫓아오)|차로.{0,20}${REPORTER_TARGET_PATTERN.source}\\s*.{0,12}들이받(?:으려|으려고|을\\s*거))`,
  );
  const otherInterpersonalDangerAction: AmoraSafetyAction = /칼|흉기/.test(text)
    ? "weapon_threat"
    : /따라오|따라와|쫓아오|스토킹/.test(text)
      ? "stalking"
      : /감금|가둬|가뒀|가둔|가두|휴대폰|전화기/.test(text)
        ? "coercive_control"
        : "physical_violence";
  const currentReporterTargetDanger =
    /(?:지금|현재|방금)\s*(?:나|저|날|절)(?:를)?\s*(?:때리|폭행|죽이|해치|목을?\s*조르)/;
  const affirmedConcreteAttempts = splitAmoraSafetyClauses(text)
    .filter(
      (clause) =>
        CONCRETE_SELF_HARM_ATTEMPT_PATTERN.test(clause)
        && !ATTEMPT_NEGATION_PATTERN.test(clause)
        && !ATTEMPT_HYPOTHETICAL_PATTERN.test(clause),
    )
    .map((clause) => ({
      actor: inferConcreteAttemptActor(clause),
      temporality: /(?:려고|려는|려|겠)/.test(clause)
        ? "impending" as const
        : "current" as const,
    }));
  if (affirmedConcreteAttempts.length > 0) {
    const hasSelfAttempt = affirmedConcreteAttempts.some(
      ({ actor }) => actor === "self",
    );
    const hasKnownOtherAttempt = affirmedConcreteAttempts.some(
      ({ actor }) => actor === "known_other",
    );
    return {
      resolution: "immediate_crisis",
      kind: hasSelfAttempt && hasKnownOtherAttempt
        ? "multi_party_self_harm"
        : hasKnownOtherAttempt
          ? "third_party_self_harm"
          : "self_harm",
      responseDirection: hasSelfAttempt && hasKnownOtherAttempt
        ? "mixed"
        : hasKnownOtherAttempt
          ? "third_party"
          : null,
      events: affirmedConcreteAttempts.map(({ actor, temporality }) => ({
        actor,
        target: "self",
        direction: "self_directed",
        action: "self_harm_attempt",
        temporality,
        polarity: "affirmed",
        context: "disclosure",
      })),
    };
  }
  if (
    CONCRETE_SELF_HARM_ATTEMPT_PATTERN.test(text)
    && ATTEMPT_NEGATION_PATTERN.test(text)
  ) {
    const actor: AmoraSafetyActor = KNOWN_OTHER_PATTERN.test(text)
      ? "known_other"
      : "self";
    return {
      resolution: "no_safety_signal",
      kind: null,
      responseDirection: null,
      events: [
        {
          actor,
          target: "self",
          direction: "self_directed",
          action: "self_harm_attempt",
          temporality: "current",
          polarity: "negated",
          context: "disclosure",
        },
      ],
    };
  }
  if (
    CONCRETE_SELF_HARM_ATTEMPT_PATTERN.test(text)
    && ATTEMPT_HYPOTHETICAL_PATTERN.test(text)
  ) {
    return {
      resolution: "non_immediate_safety",
      kind: null,
      responseDirection: null,
      events: [
        {
          actor: KNOWN_OTHER_PATTERN.test(text) ? "known_other" : "unknown",
          target: "self",
          direction: "self_directed",
          action: "self_harm_attempt",
          temporality: "hypothetical",
          polarity: "affirmed",
          context: "disclosure",
        },
      ],
    };
  }
  if (CONCRETE_SELF_HARM_ATTEMPT_PATTERN.test(text)) {
    const actor: AmoraSafetyActor = KNOWN_OTHER_PATTERN.test(text)
      ? "known_other"
      : "self";
    return {
      resolution: "immediate_crisis",
      kind: actor === "known_other" ? "third_party_self_harm" : "self_harm",
      responseDirection: actor === "known_other" ? "third_party" : null,
      events: [
        {
          actor,
          target: "self",
          direction: "self_directed",
          action: "self_harm_attempt",
          temporality: /(?:려고|려는|려|겠)/.test(text) ? "impending" : "current",
          polarity: "affirmed",
          context: "disclosure",
        },
      ],
    };
  }
  if (negatedPartnerThreat.test(text) || negatedPartnerSelfHarm.test(text)) {
    const isSelfHarm = negatedPartnerSelfHarm.test(text);
    return {
      resolution: "no_safety_signal",
      kind: null,
      responseDirection: null,
      events: [
        {
          actor: "known_other",
          target: isSelfHarm ? "self" : "reporter",
          direction: isSelfHarm ? "self_directed" : "toward_reporter",
          action: isSelfHarm ? "self_harm_intent" : "lethal_threat",
          temporality: "current",
          polarity: "negated",
          context: "disclosure",
        },
      ],
    };
  }
  if (negatedReporterSelfHarm.test(text)) {
    return {
      resolution: "no_safety_signal",
      kind: null,
      responseDirection: null,
      events: [
        {
          actor: "self",
          target: "self",
          direction: "self_directed",
          action: "self_harm_intent",
          temporality: "current",
          polarity: "negated",
          context: "disclosure",
        },
      ],
    };
  }
  if (HYPOTHETICAL_SAFETY_PATTERN.test(text)) {
    const selfDirected = /죽\s*고\s*싶다고|자살한다고|자해한다고/.test(text);
    return {
      resolution: "non_immediate_safety",
      kind: null,
      responseDirection: null,
      events: [
        {
          actor: KNOWN_OTHER_PATTERN.test(text) ? "known_other" : "unknown",
          target: selfDirected ? "self" : "reporter",
          direction: selfDirected ? "self_directed" : "toward_reporter",
          action: selfDirected ? "self_harm_intent" : "lethal_threat",
          temporality: "hypothetical",
          polarity: "affirmed",
          context: "disclosure",
        },
      ],
    };
  }
  if (
    HISTORICAL_MARKER_PATTERN.test(text)
    && RESUMED_CURRENT_VIOLENCE_PATTERN.test(text)
  ) {
    const historicalEvent: AmoraSafetyEvent = {
      actor: KNOWN_OTHER_PATTERN.test(text) ? "known_other" : "unknown",
      target: "reporter",
      direction: "toward_reporter",
      action: "physical_violence",
      temporality: "past",
      polarity: "affirmed",
      context: "disclosure",
    };
    return {
      resolution: "immediate_crisis",
      kind: "interpersonal_danger",
      responseDirection: "toward_reporter",
      events: [
        historicalEvent,
        { ...historicalEvent, temporality: "current" },
      ],
    };
  }
  if (HISTORICAL_MARKER_PATTERN.test(text) && VIOLENCE_CUE_PATTERN.test(text)) {
    const action: AmoraSafetyAction = /죽이겠|죽인다고|죽여\s*버리|칼로?\s*협박/.test(text)
      ? "lethal_threat"
      : /성폭행|성폭력|성추행|강간|동의\s*없이/.test(text)
        ? "sexual_violence"
        : /감금|가둬/.test(text)
          ? "coercive_control"
          : "physical_violence";
    return {
      resolution: "non_immediate_safety",
      kind: null,
      responseDirection: null,
      events: [
        {
          actor: KNOWN_OTHER_PATTERN.test(text) ? "known_other" : "unknown",
          target: "reporter",
          direction: "toward_reporter",
          action,
          temporality: "past",
          polarity: /지금(?:은|도)?\s*(?:안전|괜찮)/.test(text)
            ? "safe_now"
            : "affirmed",
          context: "disclosure",
        },
      ],
    };
  }

  if (reporterAggressionAndSelfHarm.test(text)) {
    return {
      resolution: "immediate_crisis",
      kind: "combined_reporter_aggressor_self_harm",
      responseDirection: "reporter_toward_other",
      events: [
        {
          actor: "self",
          target: "known_other",
          direction: "reporter_toward_other",
          action: "lethal_threat",
          temporality: "impending",
          polarity: "affirmed",
          context: "disclosure",
        },
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
    };
  }

  if (
    reporterAggression.test(text)
    || implicitReporterAggression.test(text)
    || reporterWeaponApproach.test(text)
    || reporterWeaponSwing.test(text)
  ) {
    return {
      resolution: "immediate_crisis",
      kind: "interpersonal_danger_reporter_aggressor",
      responseDirection: "reporter_toward_other",
      events: [
        {
          actor: "self",
          target: "known_other",
          direction: "reporter_toward_other",
          action: reporterWeaponApproach.test(text) || reporterWeaponSwing.test(text)
            ? "weapon_threat"
            : /죽이|죽여|해치/.test(text)
              ? "lethal_threat"
              : "physical_violence",
          temporality: /(?:러\s*(?:가|갈)|(?:거야|거예요|래))/.test(text)
            ? "impending"
            : "current",
          polarity: "affirmed",
          context: "disclosure",
        },
      ],
    };
  }

  if (deniedPartnerThreatThenSelfHarm.test(text)) {
    return {
      resolution: "immediate_crisis",
      kind: "third_party_self_harm",
      responseDirection: "third_party",
      events: [
        {
          actor: "known_other",
          target: "reporter",
          direction: "toward_reporter",
          action: "lethal_threat",
          temporality: "current",
          polarity: "negated",
          context: "disclosure",
        },
        {
          actor: "known_other",
          target: "self",
          direction: "self_directed",
          action: "self_harm_intent",
          temporality: "current",
          polarity: "affirmed",
          context: "disclosure",
        },
      ],
    };
  }

  if (deniedPartnerSelfHarmThenThreat.test(text)) {
    return {
      resolution: "immediate_crisis",
      kind: "interpersonal_danger",
      responseDirection: "toward_reporter",
      events: [
        {
          actor: "known_other",
          target: "self",
          direction: "self_directed",
          action: "self_harm_intent",
          temporality: "current",
          polarity: "negated",
          context: "disclosure",
        },
        {
          actor: "known_other",
          target: "reporter",
          direction: "toward_reporter",
          action: "lethal_threat",
          temporality: "current",
          polarity: "affirmed",
          context: "disclosure",
        },
      ],
    };
  }

  if (reporterReportsKnownOtherSelfHarm.test(text)) {
    return {
      resolution: "immediate_crisis",
      kind: "third_party_self_harm",
      responseDirection: "third_party",
      events: [
        {
          actor: "known_other",
          target: "self",
          direction: "self_directed",
          action: "self_harm_intent",
          temporality: "current",
          polarity: "affirmed",
          context: "disclosure",
        },
      ],
    };
  }

  if (
    (otherInterpersonalDanger.test(text) || currentReporterTargetDanger.test(text))
    && reporterSelfHarm.test(text)
  ) {
    return {
      resolution: "immediate_crisis",
      kind: "combined_interpersonal_self_harm",
      responseDirection: "toward_reporter",
      events: [
        {
          actor: "known_other",
          target: "reporter",
          direction: "toward_reporter",
          action: otherInterpersonalDangerAction,
          temporality: "current",
          polarity: "affirmed",
          context: "disclosure",
        },
        {
          actor: "self",
          target: "self",
          direction: "self_directed",
          action: "self_harm_intent",
          temporality: "current",
          polarity: "affirmed",
          context: "disclosure",
        },
      ],
    };
  }

  if (
    !partnerMurderSuicide.test(text)
    && !knownOtherReportsReporterSelfHarm.test(text)
    && knownOtherSelfHarm.test(text)
    && reporterSelfHarm.test(text)
  ) {
    return {
      resolution: "immediate_crisis",
      kind: "multi_party_self_harm",
      responseDirection: "mixed",
      events: [
        {
          actor: "known_other",
          target: "self",
          direction: "self_directed",
          action: "self_harm_intent",
          temporality: "current",
          polarity: "affirmed",
          context: "disclosure",
        },
        {
          actor: "self",
          target: "self",
          direction: "self_directed",
          action: "self_harm_intent",
          temporality: "current",
          polarity: "affirmed",
          context: "disclosure",
        },
      ],
    };
  }

  if (partnerMurderSuicide.test(text)) {
    return {
      resolution: "immediate_crisis",
      kind: "combined_interpersonal_self_harm",
      responseDirection: "toward_reporter",
      events: [
        {
          actor: "known_other",
          target: "reporter",
          direction: "toward_reporter",
          action: "lethal_threat",
          temporality: "impending",
          polarity: "affirmed",
          context: "disclosure",
        },
        {
          actor: "known_other",
          target: "self",
          direction: "self_directed",
          action: "self_harm_intent",
          temporality: "impending",
          polarity: "affirmed",
          context: "disclosure",
        },
      ],
    };
  }

  if (partnerThreat.test(text)) {
    return {
      resolution: "immediate_crisis",
      kind: "interpersonal_danger",
      responseDirection: "toward_reporter",
      events: [
        {
          actor: "known_other",
          target: "reporter",
          direction: "toward_reporter",
          action: "lethal_threat",
          temporality: /(?:죽인대|죽일\s*(?:거|거야)|죽이려고)/.test(text)
            ? "impending"
            : "current",
          polarity: "affirmed",
          context: "disclosure",
        },
      ],
    };
  }

  if (partnerSelfHarm.test(text)) {
    return {
      resolution: "immediate_crisis",
      kind: "third_party_self_harm",
      responseDirection: "third_party",
      events: [
        {
          actor: "known_other",
          target: "self",
          direction: "self_directed",
          action: "self_harm_intent",
          temporality: "current",
          polarity: "affirmed",
          context: "disclosure",
        },
      ],
    };
  }

  if (
    knownOtherSelfHarm.test(text)
    && !knownOtherReportsReporterSelfHarm.test(text)
  ) {
    return {
      resolution: "immediate_crisis",
      kind: "third_party_self_harm",
      responseDirection: "third_party",
      events: [
        {
          actor: "known_other",
          target: "self",
          direction: "self_directed",
          action: "self_harm_intent",
          temporality: "current",
          polarity: "affirmed",
          context: "disclosure",
        },
      ],
    };
  }

  if (
    otherInterpersonalDanger.test(text)
    || currentReporterTargetDanger.test(text)
  ) {
    return {
      resolution: "immediate_crisis",
      kind: "interpersonal_danger",
      responseDirection: "toward_reporter",
      events: [
        {
          actor: PARTNER_PATTERN.test(text) ? "known_other" : "unknown",
          target: "reporter",
          direction: "toward_reporter",
          action: otherInterpersonalDangerAction,
          temporality: "current",
          polarity: "affirmed",
          context: "disclosure",
        },
      ],
    };
  }

  if (reporterSelfHarm.test(text)) {
    return {
      resolution: "immediate_crisis",
      kind: "self_harm",
      responseDirection: null,
      events: [
        {
          actor: "self",
          target: "self",
          direction: "self_directed",
          action: "self_harm_intent",
          temporality: /(?:죽을\s*(?:래|거)|죽겠|자살|자해)/.test(text)
            ? "impending"
            : "current",
          polarity: "affirmed",
          context: "disclosure",
        },
      ],
    };
  }

  return {
    resolution: "inconclusive",
    kind: null,
    responseDirection: null,
    events: [],
  };
}
