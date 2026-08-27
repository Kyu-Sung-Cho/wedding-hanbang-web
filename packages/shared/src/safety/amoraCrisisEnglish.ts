// 안전망이 한국어 정규식 전용이라 같은 위기를 영어로 말하면 아무것도 걸리지 않았다.
//
// ## 실측 (2026-08-27)
//
// 한국어/영어 같은 뜻 12쌍을 `classifyAmoraCrisis` 에 넣었더니 **한국어 8, 영어 0** 이었다.
// "I want to kill myself" 도, "My husband hits me" 도, "I'm on the roof about to jump"
// 도 전부 `null` 이었다. null 이면 `route.ts` 의 위기 관문을 그냥 지나쳐 평범한
// 결혼 준비 답변이 나간다.
//
// ## 왜 별도 파일인가
//
// 한국어 판정기(1,041줄)에 영어 낱말을 섞으면 두 언어의 오탐이 서로 얽힌다. 이
// 저장소는 어휘를 넓히다 안전을 깬 적이 있다. 여기서는 **영어 갈래를 분리**해
// 한국어 판정에 손대지 않는다 — 영어 패턴은 한국어 문장에 새 오탐을 만들 수 없다.
//
// ## 순서
//
// 결혼 준비 영어에는 위기 낱말을 쓰는 관용구가 널려 있어서, **관용구를 먼저 지우고
// 남은 자리에서만** 위기 표현을 찾는다. 한국어 쪽이 `removeMatchingPhrases` 로 쓰는
// 것과 같은 방식이다.
//
// **다만 실제로 일하는 것은 아래 목록 중 네 묶음뿐이다.** 관용구 제외를 통째로 끄고
// 재 보니 반례 59개 중 8개만 무너졌다:
//
//   - die/dye 오타          "I want to die my hair"
//   - 비유·고유명사 suicide  "financial suicide", "Suicide Squad"
//   - "hit me up/with"      "She hit me up about the venue tour"
//   - "beat me at"          "He beat me at cards"
//
// 나머지("my feet are killing me", "to die for", "killer deal", "deadline" …)는
// **아무 일도 하지 않는다** — 애초에 양성 패턴 어디에도 안 걸린다. 지우지 않고 두는
// 이유는 나중에 누가 `killing me` 같은 넓은 양성 패턴을 넣는 순간 필요해지기
// 때문이다. 하지만 **이 목록이 길다는 것을 안전의 근거로 읽으면 안 된다.**

/** 위기 낱말을 담고 있지만 위기가 아닌 결혼 준비 영어. 먼저 지운다. */
const BENIGN_WEDDING_IDIOMS: readonly RegExp[] = [
  // "dying to see the dress" / "to die for" / "drop dead gorgeous" / "dead serious"
  /\bdying\s+to\s+\w+/gi,
  /\bto\s+die\s+for\b/gi,
  /\bdrop[\s-]?dead\s+\w+/gi,
  /\bdead\s+(?:serious|set|tired|simple|easy|center|ahead|on\s+time)\b/gi,
  /\bdeadline[s]?\b/gi,
  /\bdead\s+of\s+(?:winter|summer|night)\b/gi,
  // "I could die of embarrassment" — 창피함 관용구
  /\bdie\s+of\s+(?:embarrassment|laughter|boredom|shame)\b/gi,
  // "my feet are killing me" — 사물/신체가 주어인 경우만
  /\b(?:my\s+)?(?:feet|foot|back|head|heels|shoes|legs|eyes|budget|schedule|timeline|planning|wedding|dress|corset)\s+(?:is|are|'s|'re)\s+killing\s+me\b/gi,
  /\b(?:this|it|that|everything)\s+(?:is|'s)\s+killing\s+me\b/gi,
  // "my mom is going to kill me" — 부모 잔소리 관용구
  /\b(?:my\s+)?(?:mom|mother|dad|father|mother[\s-]?in[\s-]?law|father[\s-]?in[\s-]?law|boss|planner)\s+(?:is\s+going\s+to|will|'ll|is\s+gonna|would)\s+kill\s+me\b/gi,
  // "we killed it" / "killer deal" / "a knockout"
  /\bkill(?:ed|ing)?\s+it\b/gi,
  /\bkiller\s+\w+/gi,
  /\bknock\s?out\b/gi,
  // 사진 용어 — shot/shoot 은 촬영이다
  /\b(?:great|nice|good|the|a|detail|group|wide|money|first[\s-]look)\s+shots?\b/gi,
  /\bshot\s+(?:list|by|at|of|in)\b/gi,
  /\b(?:photo|photograph|video|drone)\s?(?:shoot|shot)\w*/gi,
  /\bshooting\s+(?:the|our|a|at|on)\b/gi,
  // "take a stab at the seating chart"
  /\b(?:take|took|taking)\s+a\s+stab\s+at\b/gi,
  // 케이크·음식 절단
  /\bcut(?:s|ting)?\s+(?:the\s+)?(?:cake|ribbon|costs?|budget|corners|hair|flowers|fabric|it\s+close)\b/gi,
  /\bcake[\s-]?cutting\b/gi,
  // 장식을 "hang" 한다
  /\bhang(?:s|ing)?\s+(?:the|up|out|our|lights|decor|drapes|a|banners?)\b/gi,
  // "scared/bored to death"
  /\b(?:scared|bored|worried|sick)\s+to\s+death\b/gi,
  // "beat the traffic" / "beat the heat"
  /\bbeat\s+(?:the|our|a)\s+\w+/gi,
  // "the heat was murder"
  /\bwas\s+murder\b/gi,
  // "I'd kill for a good caterer" / "I'd rather die than wear that"
  /\b(?:i'?d|i\s+would|we'?d|we\s+would)\s+kill\s+for\b/gi,
  /\brather\s+die\s+than\b/gi,
  // **die/dye 오타.** "I want to die my hair" 는 염색이다. 목적어가 붙으면 염색으로 읽는다.
  // 이걸 안 넣었더니 "머리 염색하고 싶어" 가 self_harm 으로 나갔다.
  /\bdie\s+(?:my|her|his|their|our|the)\s+\w+/gi,
  // "financial suicide" / "career suicide" — 비유이고, 고유명사도 있다.
  /\b(?:financial|career|political|social|budget|professional|creative|electoral)\s+suicide\b/gi,
  /\b(?:would\s+be|is|it'?s|that'?s)\s+suicide\s+(?:to|for)\b/gi,
  /\bsuicide\s+squad\b/gi,
  // "hit me up" / "beat me at cards" / "that hit me hard" — 폭력이 아니다.
  // 셋 다 처음 만든 반례에는 없었고, 반례를 어렵게 만든 뒤에야 드러났다.
  /\bhits?\s+me\s+up\b/gi,
  /\bhit\s+me\s+(?:hard|with\s+(?:a|an|the))\b/gi,
  /\bbeat\s+me\s+(?:at|to|by|in)\b/gi,
  /\bhits?\s+the\s+(?:gym|road|floor|bar|slopes|books|hay)\b/gi,
  /\bslapped\s+me\s+on\s+the\s+back\b/gi,
];

/** 부정·가정. 걸리면 그 문장은 위기로 세지 않는다. */
const NEGATED_OR_HYPOTHETICAL: readonly RegExp[] = [
  /\b(?:not|never|no\s+longer|don'?t|doesn'?t|didn'?t|won'?t|wouldn'?t|isn'?t|aren'?t|wasn'?t)\b[^.!?]{0,40}\b(?:suicidal|kill\s+myself|hurt\s+myself|harm\s+myself|want\s+to\s+die|end\s+my\s+life|abusive?)\b/i,
  /\b(?:used\s+to|years?\s+ago|back\s+then|in\s+the\s+past|when\s+i\s+was\s+(?:a\s+)?(?:kid|teen|younger))\b[^.!?]{0,60}\b(?:suicidal|kill\s+myself|hurt\s+myself|self[\s-]?harm)\b/i,
  /\b(?:if|whether|what\s+if|suppose|imagine|in\s+a\s+(?:movie|book|show|drama|game))\b[^.!?]{0,50}\b(?:kill|die|suicide|hurt)\b/i,
  /\b(?:movie|film|novel|drama|series|episode|character|lyrics?|song|article|news\s+story)\b[^.!?]{0,60}\b(?:kill|died?|suicide|abuse)\b/i,
];

const FIRST_PERSON_SELF_HARM: readonly RegExp[] = [
  /\bkill(?:ing)?\s+myself\b/i,
  /\bend(?:ing)?\s+(?:my\s+life|it\s+all)\b/i,
  /\b(?:commit(?:ting)?\s+)?suicide\b/i,
  /\bsuicidal\b/i,
  /\bwant\s+to\s+die\b/i,
  /\bwish\s+i\s+(?:was|were)\s+dead\b/i,
  /\b(?:don'?t|do\s+not|dont)\s+want\s+to\s+(?:live|be\s+here|wake\s+up|exist)\b/i,
  /\bno\s+(?:reason|point)\s+(?:to|in)\s+liv(?:e|ing)\b/i,
  /\b(?:everyone|they|you)\s+(?:would\s+be|are)\s+better\s+off\s+without\s+me\b/i,
  /\bbetter\s+off\s+dead\b/i,
  /\b(?:cut|cutting|burn|burning|hurt|hurting|harm|harming)\s+myself\b/i,
  /\bself[\s-]?harm(?:ing|ed)?\b/i,
  /\b(?:i\s+)?(?:took|swallowed)\s+(?:a\s+(?:bunch|handful|bottle)|\d{2,}|all\s+(?:my|the))\s+\w*\s?(?:pills|tablets|sleeping\s+pills|meds)\b/i,
  /\boverdos(?:e|ed|ing)\b/i,
  /\b(?:about\s+to|going\s+to|gonna|want\s+to)\s+jump\b/i,
  /\bjump\s+off\s+(?:the|a)\s+(?:roof|bridge|building|balcony|ledge)\b/i,
  /\bon\s+the\s+(?:roof|ledge|bridge)\b[^.!?]{0,30}\bjump\b/i,
];

const THIRD_PARTY_SELF_HARM: readonly RegExp[] = [
  /\b(?:my|a|his|her|their)\s+(?:friend|sister|brother|mom|mother|dad|father|cousin|coworker|fianc(?:é|e|ée|ee)|partner|bridesmaid|groomsman)\b[^.!?]{0,50}\b(?:wants?\s+to\s+die|kill(?:ing)?\s+(?:her|him|them)self|suicidal|suicide|self[\s-]?harm)/i,
  /\b(?:she|he|they)\s+(?:said|told\s+me|texted|keeps\s+saying)\b[^.!?]{0,50}\b(?:wants?\s+to\s+die|kill(?:ing)?\s+(?:her|him|them)self|end\s+(?:her|his|their)\s+life|suicidal)/i,
];

const INTERPERSONAL_DANGER: readonly RegExp[] = [
  /\b(?:he|she|they|my\s+(?:husband|wife|fianc(?:é|e|ée|ee)|partner|boyfriend|girlfriend|spouse|in[\s-]?laws?))\b[^.!?]{0,45}\b(?:hits?|hit|beats?|beat|punch(?:es|ed)?|slaps?|slapped|shoves?|shoved|chok(?:es|ed)|strangl(?:es|ed))\s+me\b/i,
  /\b(?:rap(?:e|ed|ing))\s+me\b/i,
  /\b(?:sexually\s+)?assault(?:ed)?\s+me\b/i,
  /\bforced\s+me\s+to\s+have\s+sex\b/i,
  /\bthreaten(?:ed|s)?\s+to\s+kill\s+(?:me|us)\b/i,
  /\bthreaten(?:ed|s)?\s+me\s+with\s+(?:a\s+)?(?:knife|gun|weapon|bat|scissors)\b/i,
  /\b(?:pulled|held)\s+a\s+(?:knife|gun)\s+on\s+me\b/i,
  /\block(?:s|ed)\s+me\s+in(?:side)?\b/i,
  /\b(?:won'?t|wouldn'?t|doesn'?t)\s+let\s+me\s+(?:leave|go\s+out|see\s+(?:my|anyone))\b/i,
  /\b(?:afraid|scared|terrified)\s+(?:that\s+)?(?:he|she|they)\s+(?:will|'ll|might|is\s+going\s+to|would)\s+(?:hurt|kill|hit|attack)\s+(?:me|us)\b/i,
  /\b(?:he|she|they|my\s+(?:husband|wife|fianc(?:é|e|ée|ee)|partner|boyfriend|girlfriend|spouse))\s+(?:is|'s|was|has\s+been)\s+(?:physically\s+|emotionally\s+|verbally\s+|sexually\s+)?abusive\b/i,
  /\bdomestic\s+(?:violence|abuse)\b/i,
];

export interface EnglishCrisisSignals {
  selfHarm: boolean;
  thirdPartySelfHarm: boolean;
  interpersonalDanger: boolean;
}

const NONE: EnglishCrisisSignals = {
  selfHarm: false,
  thirdPartySelfHarm: false,
  interpersonalDanger: false,
};

/** 라틴 문자가 최소한 있어야 영어 판정을 시도한다. */
const HAS_LATIN_WORDS = /[A-Za-z]{3,}/;

function stripBenignIdioms(value: string): string {
  return BENIGN_WEDDING_IDIOMS.reduce(
    (current, pattern) => current.replace(pattern, " "),
    value,
  );
}

function matchesAny(patterns: readonly RegExp[], value: string): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

/**
 * 영어 위기 신호를 센다. 한국어 판정과 **독립**이며, 한국어 문장에는
 * 라틴 낱말이 없으므로 시작부터 빠져나간다.
 */
export function assessEnglishCrisisSignals(value: string): EnglishCrisisSignals {
  if (!HAS_LATIN_WORDS.test(value)) return NONE;

  const residue = stripBenignIdioms(value);
  if (matchesAny(NEGATED_OR_HYPOTHETICAL, residue)) return NONE;

  const thirdParty = matchesAny(THIRD_PARTY_SELF_HARM, residue);
  // 3인칭이 분명하면 1인칭 자해로 세지 않는다 — 한국어 쪽 `thirdPartyOnly` 와 같은 규칙.
  const selfHarm = !thirdParty && matchesAny(FIRST_PERSON_SELF_HARM, residue);

  return {
    selfHarm,
    thirdPartySelfHarm: thirdParty,
    interpersonalDanger: matchesAny(INTERPERSONAL_DANGER, residue),
  };
}
