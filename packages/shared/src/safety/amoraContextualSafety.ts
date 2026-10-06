import type { AmoraSafetyAssessment, AmoraSafetyAction } from "./amoraCrisisClassifier";
import { isClosedPartnerViolenceStatement } from "./partnerViolenceClosedVocabulary";

// This runs only after the established classifier and closed rules abstain.
// Unknown timing/intent is a private safety conversation, never permission to share.
const PARTNER = /(?:남편|아내|와이프|배우자|신랑|신부|예랑|예신|남친|여친|파트너|상대방)/;
const META = /(?:문구|표현|단어|대사|가사|예시|캠페인|예방\s*교육|소설|영화|드라마|뉴스|기사|게임|노래\s*추천)/;
const HISTORY = /(?:예전에|과거에|작년에|몇\s*년\s*전|오래전에|어릴\s*때|해\s*본\s*적|해본\s*적)/;
const SAFE = /(?:지금|현재|이제).{0,12}(?:안전|괜찮|없어|없어요|없다)/;
const DENIAL = /(?:생각|충동).{0,12}(?:없|안\s*해|하지\s*않)|(?:때리|때린|때렸|맞|만나게).{0,12}(?:적\s*없|않|아니)|(?:안\s*때|때리지\s*않|못\s*만나게\s*하지\s*않)/;
const IDEATION = /(?:자살|자해)\s*(?:생각|충동)(?:이|은|을|도)?\s*(?:(?:자꾸|계속|요즘|진짜|또|매일)\s*)*(?:나(?:요|서|는|\s|$)|났|들|해|했|하|있)/;
const GATHERING = /(?:수면제|수면\s*유도제|안정제|항우울제|진통제|농약|약)(?:을|를)?\s*(?:(?:이미|많이|벌써|몰래|조금씩|한\s*달\s*치)\s*)*모(?:아\s*(?:뒀|놨|놓|두)|았|으고)/;
const PRACTICAL_MEDICINE = /(?:신혼여행|여행|짐|상비약|처방|복용|약국|캠핑|농사|폐기|정리|분리수거)/;
const ASSAULT = /때(?:려(?:요|서|서요|$|\s)|린다고)|(?:애|아이|강아지|벽)(?:를|을)?\s*때려|(?:술\s*먹으면|술\s*마시면)\s*맞(?:아요|아|고)/;
const RECIPIENT_ASSAULT = /(?:와이프|아내|남편|배우자|신랑|신부)(?:한테|에게)\s*맞(?:아요|아|고|았)/;
const THREAT = /(?:말\s*안\s*들으면|연락\s*안\s*받으면|파혼하면|헤어지면|이혼하면|거절하면|신고하면)\s*(?:죽인대|때린대|가만\s*안\s*둔대)/;
const ISOLATION = /(?:친구들?|가족|아무도|엄마)(?:을|를|랑|도)?\s*못\s*만나게\s*(?:해|하|했)/;
// Closed event statements already have a dedicated rule. This layer handles
// their discourse extensions and missing event relationships, not that grammar.
const DISCLOSURE_EXTENSION = /(?:어떡|도와|무서|답답|속상|그래서|때려서|[?🙏\uE001])/u;
const NEW_VIOLENCE_RELATION = /(?:말\s*안\s*들으면|연락\s*안\s*받으면|때린다고\s*했|(?:애|아이|강아지|벽)(?:를|을)?\s*때려|술\s*먹으면\s*맞|와이프한테\s*맞아요|싸우다가\s*다쳤)/;
const EXPLICIT_PARTNER_SUBJECT = new RegExp(`(?:^|\\s)(${PARTNER.source}(?:이|가|은|는)\\s*[^.!\\n]*)$`);
const DANGER_EVIDENCE = /(?:자살|자해|죽|목숨|유서|약|칼|흉기|폭행|폭력|때(?:리|려|렸|린|릴)|맞|던지|던져|던졌|위협|협박|감금|스토킹)/;
const BOUND_EVENT_DENIAL = /(?:협박|위협|폭행|때리)[^.!?\n]{0,14}(?:적\s*없(?:어|어요|다)|지(?:는|도)?\s*않(?:아|아요|았어요|는다)|(?:건|게|것은)\s*아니(?:에요|야|다|라고)?)\s*$/;
const ORDINARY_OBJECT_ACTION = new RegExp(`^${PARTNER.source}(?:이|가|은|는)\\s*(?:북|드럼|피아노|공|키보드|계산기\\s*버튼)(?:을|를)\\s*(?:(?:계속|세게|열심히)\\s*)*때(?:려(?:요)?|렸(?:어|어요|습니다)|리(?:고\\s*있(?:어|어요)|는\\s*중(?:이에요)?|고|나요|죠|습니다))\\s*[?？]?$`);

function projectCurrentTimeAdjuncts(text: string): string {
  return text.replace(/(^|\s)(?:지금|현재|방금|오늘)(?:은|는|도)?(?=\s|$)/g, "$1");
}

function withoutQuotedText(text: string): string {
  return text.replace(/"[^"\n]*"|“[^”\n]*”|'[^'\n]*'|‘[^’\n]*’/g, " ");
}

/** A literal designated as wording cannot supply a human event by itself. */
export function isQuotedSafetyReferenceOnly(text: string): boolean {
  const unquoted = withoutQuotedText(text);
  return unquoted !== text
    && /(?:라는|란)\s*(?:문장|문구|표현|대사|가사|단어)/.test(unquoted)
    && !DANGER_EVIDENCE.test(unquoted);
}

/** One discourse boundary policy for actor questions and human disclosures. */
function safetyDiscourseClauses(text: string): string[] {
  return text.split(/(?:[.!;\n]+|(?<=[?？])\s*|하지만|그런데|근데|\s+그리고\s+|(?:게|것이)\s*아니라\s*|(?<=는데|지만)\s*)/u)
    .map((clause) => clause.trim()).filter(Boolean);
}

/** The event grammar, not the cause's topic or verb ending, establishes risk. */
function hasAffirmedPartnerEvent(clause: string, realWorldSourceComparison = false): boolean {
  if ((!realWorldSourceComparison && META.test(clause)) || DENIAL.test(clause) || HISTORY.test(clause)
    || /(?:가정|만약|가령)/.test(clause)) return false;
  // Bind an explicit actor to the entire remaining event statement. A suffix
  // such as "라는 대사", a hypothetical predicate or an everyday object cannot
  // borrow an assault verb: the existing closed grammar must accept it whole.
  const statement = clause.match(EXPLICIT_PARTNER_SUBJECT)?.[1];
  if (statement == null) return false;
  const prefix = projectCurrentTimeAdjuncts(clause.slice(0, clause.length - statement.length))
    .replace(/(^|\s)(?:실제로(?:는)?|현실에서는)(?=\s|$)/g, "$1");
  // Two adjacent nominative subjects are not an established causal/event
  // relationship ("친구가 남편이 ..."). Do not silently assign that person's
  // incomplete report to this couple; it needs its own relational evidence.
  if (/(?:^|\s)[가-힣]+(?:가|이|은|는)\s*(?:(?:우리|제|내)\s*)?$/.test(prefix)) return false;
  // Current-time adjuncts qualify the event, not its actor or polarity. Remove
  // only standalone present-time tokens for grammar matching, wherever they
  // occur in the bound event. The original clause retains its time evidence.
  const eventGrammar = projectCurrentTimeAdjuncts(statement);
  return isClosedPartnerViolenceStatement(eventGrammar);
}

/** A question addressed solely to the assistant is not a human disclosure. */
export function isBotDirectedIdeationQuestion(text: string): boolean {
  const question = /^(?:아모라|챗지피티|chatgpt|봇)(?:야|에게|한테)?\s*[,，]?\s*(?:너(?:는|도)?|넌|당신(?:은|도)?)\s*(?:(?:자살|자해|죽고\s*싶(?:은|다는))\s*(?:생각|충동)(?:이|은|도)?\s*(?:(?:자꾸|계속)\s*)?(?:있어|있어요|나|나요|해|해요)|죽고\s*싶(?:어|어요|니|나요))\s*[?？]\s*$/i;
  const clauses = safetyDiscourseClauses(text);
  // Only an explicit human denial can accompany this exclusion. A first-person
  // affirmation, including one referring back to the question, keeps the fence.
  const isQuestion = (clause: string) => question.test(projectCurrentTimeAdjuncts(clause));
  return clauses.some(isQuestion) && clauses.every((clause) => isQuestion(clause)
    || /^(?:나는|난|저는|전)\s*(?:그런|자살|자해)\s*생각(?:이|은|도)?\s*(?:전혀\s*)?없(?:어|어요|다|습니다)[.!]?\s*$/.test(clause));
}

/**
 * Resolve explicit event frames before legacy wildcard crisis rules. Excluding
 * one frame is not permission to exclude an independent or unresolved danger.
 */
export function assessBoundSafetyContext(text: string): AmoraSafetyAssessment | null {
  let excluded = false;
  let unresolved = false;
  const threats: AmoraSafetyAssessment[] = [];
  let ideationReferent = false;
  let uncertainHumanReferent = false;
  let adjacentPartner: string | null = null;
  for (const clause of safetyDiscourseClauses(text)) {
    const humanReference = /^(?:(?:나는|난|저는|전|내가|제가|나도|저도)\s*)?(?:(?:지금|현재|오늘)(?:은|는)?\s*)?(?:그런|그|같은)\s*(?:생각|충동)(?:이|은|도)?/.exec(clause);
    const uncertainHumanReference = /^(?:나도|저도)\s*(?:그래|그렇|같)/.test(clause);
    if (ideationReferent && (humanReference || uncertainHumanReference)) {
      const predicate = humanReference ? clause.slice(humanReference[0].length) : clause;
      if (DENIAL.test(clause) || /(?:없|아니|하지\s*않|안\s*해)/.test(predicate)) { excluded = true; continue; }
      // A human reference to the preceding ideation cannot disappear merely
      // because its words are not repeated. Unknown intent stays private too.
      const affirmed = /^(?:자꾸\s*|계속\s*)*(?:있|들|나|해)/.test(predicate.trim());
      const uncertain = /(?:모르|확신|애매|있는지|인지)/.test(predicate) || uncertainHumanReference;
      uncertainHumanReferent ||= uncertain;
      threats.push(assessment("self_harm_intent", affirmed && !uncertain && !HISTORY.test(clause), HISTORY.test(clause)));
      continue;
    }
    if (/(?:자살|자해|죽고\s*싶)/.test(clause)) ideationReferent = true;
    const previousPartner = adjacentPartner;
    adjacentPartner = clause.match(EXPLICIT_PARTNER_SUBJECT)?.[1].match(PARTNER)?.[0] ?? null;
    if (!DANGER_EVIDENCE.test(clause)) continue;
    if (isBotDirectedIdeationQuestion(clause) || isQuotedSafetyReferenceOnly(clause)) {
      excluded = true;
      continue;
    }
    let statement = clause.match(EXPLICIT_PARTNER_SUBJECT)?.[1];
    if (statement == null && previousPartner && /^(?:지금|현재|오늘|방금)(?:은|는|도)?\s*/.test(clause)
      && /협박|위협/.test(clause)) statement = `${previousPartner}이 ${clause}`;
    const fiction = /(?:영화|드라마|소설)(?:에서(?:는|도)?|\s*속(?:에서)?)(?=\s|$)/.exec(clause);
    const actorPosition = statement == null ? -1 : clause.length - statement.length;
    const mediaActivity = fiction && actorPosition > fiction.index
      && /(?:본|보고|보다가|들은|듣고|읽은|읽고|대사로|장면을)/.test(clause.slice(fiction.index + fiction[0].length, actorPosition));
    if (fiction && fiction.index < actorPosition
      && !mediaActivity
      && !/(?:실제로|현실에서|현실에서는|나는|저는|내가|제가)/.test(clause)) {
      excluded = true;
      continue;
    }
    const event = statement == null ? null : projectCurrentTimeAdjuncts(statement);
    if (event && /협박|위협/.test(event) && BOUND_EVENT_DENIAL.test(event)) {
      excluded = true;
      continue;
    }
    // Instrument, sporting equipment and input-device objects license this
    // literal striking action. A person/animal, thrown property, or a second
    // violent predicate is not covered by this affirmative nonhuman frame.
    if (event && ORDINARY_OBJECT_ACTION.test(event)) {
      excluded = true;
      continue;
    }
    // Quoted threats are events when a human actor makes the threat. Keep the
    // quotation here: stripping it would discard the dangerous content.
    // Korean reported present speech uses 죽인다고 as well as 죽이겠다고.
    // Both require the bound human actor and an affirmative threat predicate.
    const dangerousSpeech = /(?:죽(?:이|인|일|여)|때(?:리|릴|려))/.test(statement ?? "");
    const reportedThreat = /(?:죽(?:이|인|일|여)|때(?:리|릴|려))[^.!?\n]{0,24}(?:다고|라고)[^.!?\n]{0,16}협박(?:해|하|했)/.test(statement ?? "");
    const quotedThreat = statement != null && withoutQuotedText(statement) !== statement
      && dangerousSpeech && /협박(?:해|하|했)/.test(withoutQuotedText(statement));
    if (statement && !DENIAL.test(clause) && !HISTORY.test(clause)
      && (reportedThreat || quotedThreat)) {
      threats.push(assessment(/죽/.test(statement) ? "lethal_threat" : "physical_violence", true, false));
      continue;
    }
    const comparison = /(?:처럼|듯이|듯)\s/.test(clause);
    if (hasAffirmedPartnerEvent(clause, comparison)) {
      threats.push(assessment("physical_violence", false, false));
      continue;
    }
    if (event && !META.test(clause) && !DENIAL.test(clause) && !HISTORY.test(clause)
      && /(?:접시|물건|컵|휴대폰|유리컵)(?:을|를)?\s*(?:집어\s*)?던(?:져(?:요)?|졌(?:어|어요))\s*$/.test(event)) {
      threats.push(assessment("physical_violence", false, false));
      continue;
    }
    unresolved = true;
  }
  if (!unresolved && excluded && threats.length === 0) {
    return { resolution: "no_safety_signal", kind: null, responseDirection: null, events: [], contextBoundaryResolved: true };
  }
  const strongest = threats.find((item) => item.resolution === "immediate_crisis") ?? threats[0] ?? null;
  // A fully scoped assistant question plus uncertain human reference warrants
  // private clarification, not an immediate intent borrowed from the bot.
  if (strongest && uncertainHumanReferent && !unresolved
    && threats.every((item) => item.resolution === "non_immediate_safety"
      && item.events[0]?.action === "self_harm_intent")) {
    return { ...strongest, contextBoundaryResolved: true };
  }
  return strongest;
}

/**
 * Bind exclusions to their own clause. Viewing media is a real-world activity;
 * quoting a line from that media is still meta. Contrast endings close the old
 * denial/history, rather than applying it to a renewed disclosure.
 */
export function scopedSafetyDisclosureCandidates(text: string): readonly string[] {
  const withoutMediaActivity = withoutQuotedText(text)
    // Quoted text may be an example, a lyric, or a human report. The established
    // classifier still sees the original report; this residual pass only sees
    // unquoted affirmative disclosures and cannot borrow a quotation's event.
    .replace(/(?:뉴스|기사|영화|드라마)(?:를|을)?\s*(?:보(?:다가|고(?:\s*나서)?|고서)|읽(?:다가|고(?:\s*나서)?))\s*/g, " ")
    .replace(/(?:영화|드라마)\s*대사\s*때문(?:인지|에)\s*/g, " ");
  const clauses = safetyDiscourseClauses(withoutMediaActivity);
  if (clauses.length < 2 && withoutMediaActivity === text) return [];
  const candidates: string[] = [];
  let adjacentPartner: string | null = null;
  for (const clause of clauses) {
    if (isBotDirectedIdeationQuestion(clause) || isQuotedSafetyReferenceOnly(clause)) {
      adjacentPartner = null;
      continue;
    }
    const ownPartner = clause.match(PARTNER)?.[0] ?? null;
    if (META.test(clause)) { adjacentPartner = null; continue; }
    const deniedOrPast = DENIAL.test(clause) || HISTORY.test(clause);
    if (!deniedOrPast && !/(?:생각|충동).{0,12}(?:있으면|한다면|하면)|가정/.test(clause)) {
      const candidate = !ownPartner && adjacentPartner && (/(?:지금|오늘|현재|방금)/.test(clause)
        || /^(?:나|저|날|절)(?:를|에게|한테)?\s/.test(clause))
        && ASSAULT.test(clause) ? `${adjacentPartner}이 ${clause}` : clause;
      // Require an affirmative event, not simply a time marker or help word.
      if (assessContextualAmoraSafety(candidate)) candidates.push(candidate);
    }
    // Only adjacent relational context can supply a dropped Korean subject.
    adjacentPartner = ownPartner;
  }
  return candidates;
}

function assessment(action: AmoraSafetyAction, immediate: boolean, past: boolean, other = false): AmoraSafetyAssessment {
  const selfHarm = action === "self_harm_intent";
  return {
    resolution: immediate ? "immediate_crisis" : "non_immediate_safety",
    kind: immediate ? selfHarm ? other ? "third_party_self_harm" : "self_harm" : "interpersonal_danger" : null,
    responseDirection: selfHarm ? null : "toward_reporter",
    events: [{
      actor: selfHarm && !other ? "self" : "known_other",
      target: selfHarm ? other ? "known_other" : "self" : "unknown",
      direction: selfHarm ? other ? "third_party" : "self_directed" : "unknown",
      action, temporality: past ? "past" : "current",
      polarity: "affirmed", context: "disclosure",
    }],
  };
}

export function assessContextualAmoraSafety(text: string): AmoraSafetyAssessment | null {
  const found: AmoraSafetyAssessment[] = [];
  // Help questions and emoji are delivery syntax, not a denial of the disclosure.
  for (const clause of safetyDiscourseClauses(withoutQuotedText(text).replace(/-\.-/g, " \uE001 "))) {
    if (META.test(clause) || DENIAL.test(clause)) continue;
    const past = HISTORY.test(clause) || /생각이\s*났/.test(clause);
    if (IDEATION.test(clause)) {
      // A direct question about someone else's thoughts is not a self report.
      if (/^(?:너|당신)(?:는|도)?\s/.test(clause.trim())
        || /^(?:자살|자해)\s*생각\s*(?:해|해요|있어|있어요)\s*[?？]\s*$/.test(clause.trim())
        || /생각하는\s*사람/.test(clause)) continue;
      const other = /(?:친구|엄마|아빠|동생|남편|아내|배우자)(?:가|이|는|도)\s/.test(clause);
      found.push(assessment("self_harm_intent", !past && !SAFE.test(clause), past, other));
      continue;
    }
    // A bare stockpile lacks purpose. Ask privately; don't assert an attempt or
    // discard a packing answer. Explicit packing/prescription context is benign.
    if (GATHERING.test(clause) && !PRACTICAL_MEDICINE.test(clause)) {
      // We have not established intent, actor, or a current attempt.
      found.push({ resolution: "non_immediate_safety", kind: null, responseDirection: null, events: [] });
      continue;
    }
    const violence = (PARTNER.test(clause) && ASSAULT.test(clause))
      || RECIPIENT_ASSAULT.test(clause) || THREAT.test(clause)
      || /싸우다가\s*다쳤/.test(clause);
    const isolation = ISOLATION.test(clause)
      && !/(?:감기|독감|감염|격리|출장|일정|바빠|못\s*만나게\s*됐)/.test(clause);
    if ((violence || isolation)
      && (DISCLOSURE_EXTENSION.test(clause) || NEW_VIOLENCE_RELATION.test(clause)
        || hasAffirmedPartnerEvent(clause.trim()))) {
      found.push(assessment(isolation ? "coercive_control" : THREAT.test(clause) ? "lethal_threat" : "physical_violence", false, past));
    }
  }
  return found.find((item) => item.resolution === "immediate_crisis") ?? found[0] ?? null;
}

/** Resolve only an explicitly closed past episode followed by a separate safe-now statement. */
export function assessResolvedHistoricalIdeation(text: string): AmoraSafetyAssessment | null {
  const clauses = safetyDiscourseClauses(text);
  if (!clauses.some((clause) => /^(?:지금|현재|이제)(?:은|는)?\s*(?:안전|괜찮)/.test(clause))) return null;
  let hasPastIdeation = false;
  for (const clause of clauses) {
    if (!/(?:자살|자해|죽|목숨|유서|약|칼|흉기|폭행|폭력|때리|때려|맞|위협|협박|감금|스토킹)/.test(clause)) continue;
    // Every danger-bearing clause must be the past ideation itself. A current
    // attempt, renewed thought, or other-person danger cannot borrow "safe now".
    if (META.test(clause) || DENIAL.test(clause) || !IDEATION.test(clause)
      || !(HISTORY.test(clause) || /생각이\s*났/.test(clause))
      || /(?:지금|현재|오늘|또|다시)/.test(clause)) return null;
    hasPastIdeation = true;
  }
  return hasPastIdeation ? assessment("self_harm_intent", false, true) : null;
}
