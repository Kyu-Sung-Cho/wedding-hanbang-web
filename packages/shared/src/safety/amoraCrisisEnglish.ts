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
  // "beat the traffic" / "beat the heat" — 단, "beat the hell out of me" 는
  // 실제 폭행이므로 뺀다. 안 뺐더니 그 문장이 판정 없음으로 나갔다.
  /\bbeat\s+(?:the|our|a)\s+(?!hell\b|crap\b|shit\b)\w+/gi,
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
  /\bhit(?:s|ting)?\s+me\s+up\b/gi,
  /**
   * **이 둘은 원래 넓었고, 진짜 폭력 서술을 지우고 있었다.**
   *
   *     "My husband hit me with a belt last night"   → 판정 없음
   *     "He hit me hard in the face again"           → 판정 없음
   *
   * `hit me with a *` 와 `hit me hard` 를 통째로 지웠기 때문이다. 막으려던 것은
   * "He hit me with a huge quote"(견적) 와 "That news hit me hard" 뿐이므로,
   * **목적어와 주어를 못박아** 그 둘만 남긴다.
   */
  /\bhit\s+me\s+with\s+(?:a|an|the|another)?\s*(?:huge|big|massive|hefty|surprise|unexpected|another|\d+)?\s*(?:quote|bill|invoice|fee|charge|estimate|price|number|news|question|update|idea|request|surcharge|guests?|people|changes?|demands?)\b/gi,
  /\b(?:that|this|it|the\s+news|news|the\s+cost|reality)\s+hit\s+me\s+hard\b/gi,
  /\bbeat(?:s|ing)?\s+me\s+(?:at|to|by|in)\b/gi,
  /\bhits?\s+the\s+(?:gym|road|floor|bar|slopes|books|hay)\b/gi,
  /\bslapped\s+me\s+on\s+the\s+back\b/gi,
  /\bdomestic\s+(?:violence|abuse)\s+(?:awareness|charity|charities|organi[sz]ation|nonprofit|shelter|hotline|helpline|campaign|fundraiser|foundation|month|prevention|survivors?)\b/gi,
  /\b(?:awareness|charity|donation|fundraiser|campaign|shelter|hotline)\b[^.!?]{0,32}\bdomestic\s+(?:violence|abuse)\b/gi,
  // 업체가 비용을 "때린다" 는 영어 관용구. "They slapped me with a huge
  // cancellation fee" 가 폭력으로 나갔다.
  /\b(?:slapped|hit|stuck|charged)\s+me\s+with\s+(?:a|an|the)?\s*[^.!?]{0,24}(?:fee|charge|bill|invoice|penalty|surcharge|cost|deposit|quote)\b/gi,
  // 사진 찍느라 자리로 밀어 넣는 것.
  /\b(?:shoved|pushed|squeezed)\s+me\s+(?:into|in\s+front\s+of|to\s+the\s+front\s+of)\s+(?:the|a|our)\s+(?:photo|picture|shot|frame|group|line|queue|crowd|aisle)/gi,
  // 결혼 준비를 "죽도록 한다" 는 관용구. "I've been killing myself trying to…"
  /\b(?:been\s+)?killing\s+myself\s+(?:trying|to\s+(?:get|make|find|plan|finish)|over|for)\b/gi,
  // 직역하면 자해지만 실제로는 부상이다.
  /\bhurt\s+myself\s+(?:lifting|carrying|moving|walking|running|dancing|climbing|on\s+the)\b/gi,
  // 예약을 "잡아채러 뛰어든다".
  /\b(?:want|going|need)\s*(?:to|na)?\s+jump\s+(?:on|at)\s+(?:that|the|this|it)\b/gi,
  // "is (basically) suicide for our budget" — 비유가 더 온다.
  /\b(?:is|would\s+be|was)\s+(?:basically|practically|literally|pretty\s+much|just)?\s*suicide\b/gi,
  // "no point in living in <지명>" — 사는 곳 이야기다.
  /\b(?:no\s+point|pointless)\s+in\s+living\s+in\s+\w+/gi,
  // 염색 목적어가 대명사인 경우("die it a shade darker").
  /\bdie\s+it\s+(?:a|an|the|any)\b/gi,
  // "I don't want to live with my in-laws" — 동거 이야기다.
  /\bwant\s+to\s+live\s+(?:with|in|near|next\s+to|abroad|alone|together)\b/gi,
  // 새벽 기상 이야기.
  /\bwant\s+to\s+wake\s+up\s+(?:at|before|early|that\s+early)\b/gi,
  // 자살예방 기관을 직업·기관으로 언급하는 경우.
  /\bsuicide\s+(?:prevention|hotline|helpline|awareness|crisis\s+line)\b/gi,
];

/**
 * 부정·가정. **한 절(clause) 안에서만** 판정한다 — 아래 `clausesOf` 참고.
 *
 * 처음에는 이걸 문장 전체에 걸었다. 적대적 검토가 그 자리에서 **11개 중 9개**를
 * 무너뜨렸다. 부정어가 다른 것에 걸려 있어도 뒤따르는 고백까지 통째로 삼켰다:
 *
 *     "I'm not okay, I want to kill myself"        → 아무것도 아님
 *     "He's not abusive, he just hits me"          → 아무것도 아님
 *     "I don't want to be a burden, I'm going to kill myself"
 *
 * 셋 다 영어권 위기 고백의 교과서적 도입부다. 한국어 갈래는 처음부터
 * `SEGMENT_BOUNDARY_PATTERN` 으로 절을 쪼개 절 단위로 판정하고 있었다 —
 * 영어 갈래에만 그 분절이 없었다.
 */
const NEGATED_OR_HYPOTHETICAL: readonly RegExp[] = [
  // 물리적 폭력 동사가 빠져 있어서 "He doesn't hit me" 가 폭력으로 나갔다.
  // 자해 어휘 쪽으로만 치우쳐 있던 같은 비대칭의 반대쪽 증상이다.
  /\b(?:not|never|no\s+longer|don'?t|doesn'?t|didn'?t|won'?t|wouldn'?t|isn'?t|aren'?t|wasn'?t|hasn'?t|haven'?t)\b[^.!?]{0,40}\b(?:suicidal|kill\s+myself|hurt\s+myself|harm\s+myself|want\s+to\s+die|end\s+my\s+life|abusive?|hits?\s+me|hit\s+me|beats?\s+me|rape[d]?\s+me|threaten(?:ed|s)?\s+me)\b/i,
  /\b(?:used\s+to|years?\s+ago|back\s+then|in\s+the\s+past|when\s+i\s+was\s+(?:a\s+)?(?:kid|teen|younger))\b[^.!?]{0,60}\b(?:suicidal|kill\s+myself|hurt\s+myself|self[\s-]?harm)\b/i,
  // **맨 `if` 를 뺐다.** 영어 화자는 능동적 자살사고를 "I keep wondering if I
  // should just kill myself" 처럼 자주 쓴다. 맨 `if` 를 가정법 신호로 읽으면
  // 그 어법 전체가 픽션으로 분류된다. 그리고 이 대안은 음성 코퍼스 59개 중
  // 아무것도 지키고 있지 않았다 — 지키는 것은 아래 `movie` 갈래다.
  /\b(?:what\s+if|whether|suppose|imagine|hypothetically|in\s+a\s+(?:movie|book|show|drama|game))\b[^.!?]{0,50}\b(?:kill|die|suicide|hurt)\b/i,
  /\b(?:movie|film|novel|drama|series|episode|character|lyrics?|song|article|news\s+story)\b[^.!?]{0,60}\b(?:kill|died?|suicide|abuse)\b/i,
];

/**
 * 절 경계. 한국어 갈래의 `SEGMENT_BOUNDARY_PATTERN` 이 하는 일을 영어로 한다.
 *
 * `but` 을 넣은 이유: "I'm not sure how to say this **but** I want to kill myself"
 * 처럼 부정과 고백을 잇는 가장 흔한 접속사다.
 */
const CLAUSE_BOUNDARY = /[.!?;\n]+|,\s*|\s+but\s+/i;

function clausesOf(value: string): string[] {
  return value.split(CLAUSE_BOUNDARY).map((c) => c.trim()).filter(Boolean);
}

const FIRST_PERSON_SELF_HARM: readonly RegExp[] = [
  /\bkill(?:ing)?\s+myself\b/i,
  /\bhang(?:ing)?\s+myself\b/i,
  /\bend(?:ing)?\s+(?:my\s+life|it\s+all)\b/i,
  /\b(?:commit(?:ting)?\s+)?suicide\b/i,
  /\bsuicidal\b/i,
  // `wanna`·`gonna` 는 위기 고백에서 가장 흔한 축약이다("i just wanna die").
  /\b(?:want|wanna)\s*(?:to\s+)?die\b/i,
  /\b(?:cut|cutting)\s+my\s+(?:wrists?|arms?|legs?|thighs?)\b/i,
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
  // `husband`·`wife` 가 빠져 있었다 — 결혼 준비 앱에서 가장 먼저 나올 상대다.
  /\b(?:my|a|his|her|their)\s+(?:friend|sister|brother|mom|mother|dad|father|cousin|coworker|husband|wife|fianc(?:é|e|ée|ee)|partner|bridesmaid|groomsman)\b[^.!?]{0,50}\b(?:wants?\s+to\s+die|kill(?:ing)?\s+(?:her|him|them)self|hang(?:ing)?\s+(?:her|him|them)self|suicidal|suicide|self[\s-]?harm)/i,
  /\b(?:she|he|they)\s+(?:said|told\s+me|texted|keeps\s+saying)\b[^.!?]{0,50}\b(?:wants?\s+to\s+die|kill(?:ing)?\s+(?:her|him|them)self|end\s+(?:her|his|their)\s+life|suicidal)/i,
];

const INTERPERSONAL_DANGER: readonly RegExp[] = [
  // `groom`·`bride` 가 빠져 있었다. 결혼 준비 앱인데 **가장 먼저 나올 상대**다.
  // 2026-08-29 에 범위 어휘에만 이 낱말들을 넣었다가 되돌린 적이 있다:
  //
  //     my husband hits me  -> W5 안전       (husband 는 여기 있다)
  //     my groom hits me    -> W0 + 기억 ON  (groom 은 여기 없었다)
  //
  // 19문장 중 16건이 그렇게 뒤집혔다. 학대 서술이 결혼 준비 대화가 되고
  // 두 사람이 함께 보는 장기 기억에 적재된다. **범위 어휘를 넓히기 전에
  // 여기부터 넓혀야 한다.**
  // 진행형(`choking`·`hitting`)과 발로 차는 것이 빠져 있었다. "He is choking me
  // right now" 는 가장 급한 문장인데 `chok(?:es|ed)` 로는 안 걸렸다.
  /\b(?:he|she|they|my\s+(?:husband|wife|fianc(?:é|e|ée|ee)|partner|boyfriend|girlfriend|spouse|in[\s-]?laws?|groom|bride|groomsman|bridesmaid|maid\s+of\s+honor))\b[^.!?]{0,45}\b(?:hits?|hit|hitting|beats?|beat|beating|punch(?:es|ed|ing)?|slaps?|slapped|slapping|shoves?|shoved|shoving|kick(?:s|ed|ing)?|chok(?:es|ed|ing)|strangl(?:es|ed|ing)|drag(?:s|ged|ging)?)\s+me\b/i,
  /\bbeat\s+the\s+(?:hell|crap|shit)\s+out\s+of\s+me\b/i,
  // 능동형만 있어서 "I was raped last night" 이 안 걸렸다.
  /\b(?:rap(?:e|ed|ing))\s+me\b/i,
  /\bi\s+(?:was|got)\s+(?:rap(?:ed)|sexually\s+assaulted|assaulted|attacked|beaten|strangled)\b/i,
  /\bi\s+(?:am|'m|was|have\s+been)\s+being\s+(?:(?:physically|emotionally|verbally|sexually)\s+)*(?:abused|assaulted|beaten|hurt|hit)\b/i,
  /\b(?:sexually\s+)?assault(?:ed)?\s+me\b/i,
  /\bforced\s+me\s+to\s+have\s+sex\b/i,
  /\bthreaten(?:ed|s)?\s+to\s+kill\s+(?:me|us)\b/i,
  // "He said he would kill me" · "he's going to kill me" — 위협의 전달 형태.
  /\b(?:he|she|they)\s+(?:said|told\s+me)\b[^.!?]{0,30}\b(?:would|will|'ll|'d|is\s+going\s+to|gonna)\s+(?:kill|hurt|beat)\s+(?:me|us)\b/i,
  /\b(?:he|she|they)(?:'s|\s+is|\s+was)\s+going\s+to\s+(?:kill|hurt|beat|attack)\s+(?:me|us)\b/i,
  /\bthreaten(?:ed|s)?\s+me\s+with\s+(?:a\s+)?(?:knife|gun|weapon|bat|scissors)\b/i,
  /\b(?:he|she|they|my\s+(?:husband|wife|fianc(?:é|e|ée|ee)|partner|boyfriend|girlfriend|spouse))\s+(?:keeps?|kept|is|'s|was|has\s+been)\s+threaten(?:ing|ed|s)?\s+(?:me|us)\b/i,
  /\b(?:pulled|held)\s+a\s+(?:knife|gun)\s+on\s+me\b/i,
  /**
   * **주어를 사람으로 못박는다.** 원래는 주어를 안 봐서 업체가 주어인 평범한
   * 문장이 감금으로 나갔다:
   *
   *     "The venue won't let me leave before 11pm"            → 폭력
   *     "The studio won't let me see my original photo files" → 폭력
   *     "The deposit locks me in for the September date"      → 폭력
   *
   * 셋 다 결혼 준비에서 매일 나올 말이다.
   */
  /\b(?:he|she|they|my\s+(?:husband|wife|fianc(?:é|e|ée|ee)|partner|boyfriend|girlfriend|spouse|in[\s-]?laws?|groom|bride|groomsman|bridesmaid|maid\s+of\s+honor))\b[^.!?]{0,20}\block(?:s|ed)\s+me\s+in(?:side)?\b/i,
  /\b(?:he|she|they|my\s+(?:husband|wife|fianc(?:é|e|ée|ee)|partner|boyfriend|girlfriend|spouse|in[\s-]?laws?|groom|bride|groomsman|bridesmaid|maid\s+of\s+honor))\b[^.!?]{0,20}(?:won'?t|wouldn'?t|doesn'?t|does\s+not)\s+let\s+me\s+(?:leave|go\s+out|see\s+(?:my|anyone))\b/i,
  /\b(?:afraid|scared|terrified)\s+(?:that\s+)?(?:he|she|they)\s+(?:will|'ll|might|is\s+going\s+to|would)\s+(?:hurt|kill|hit|attack)\s+(?:me|us)\b/i,
  /\b(?:he|she|they|my\s+(?:husband|wife|fianc(?:é|e|ée|ee)|partner|boyfriend|girlfriend|spouse|groom|bride|groomsman|bridesmaid))\s+(?:is|'s|was|has\s+been)\s+(?:(?:physically|emotionally|verbally|sexually|financially)\s+(?:and\s+)?)*abusive\b/i,
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

/**
 * **한글이 한 글자라도 있으면 영어 갈래를 아예 돌리지 않는다.**
 *
 * 처음에는 "라틴 낱말이 3자 이상 있으면" 이었고, 그때 나는 계약문에
 * "영어 패턴은 한국어 문장에 새 오탐을 만들 수 없다" 고 적었다. **틀렸다.**
 * 한국 사용자는 영어 낱말을 일상적으로 섞어 쓴다:
 *
 *     "축가 후보인 팝송 제목이 Suicide Blonde 인데 괜찮을까요?"   → self_harm
 *     "뉴스에서 domestic violence 기사 봤는데…"                  → 폭력
 *     "친구가 손목을 그었어요. self-harm 이라고 하죠?"            → 3인칭이 1인칭으로
 *
 * 한국어 판정기에는 픽션·메타·부정 관문이 촘촘히 있지만 그것들은 **한국어 문장에**
 * 작동한다. 영어 낱말 하나가 그 관문을 전부 우회했다.
 *
 * 그래서 갈래를 나누는 기준을 "영어가 섞였는가" 에서 **"한국어가 아닌가"** 로 바꾼다.
 * 한글이 섞인 문장은 한국어 판정기가 온전히 책임진다.
 *
 * 이 선택의 비용: 한영 혼용 위기 발화("진짜 I want to die")는 영어 갈래가 안 본다.
 * 한국어 어휘가 함께 있으면 한국어 갈래가 잡고, 없으면 놓친다. 순수 영문이
 * 696건 중 2건인 제품에서 혼용 위기 발화의 빈도는 그보다 낮고, 반대편 비용
 * (평범한 한국어 대화가 위기로 끊기고 비공개 레인에 잠기는 것)은 매일 발생한다.
 */
const HANGUL = /[ᄀ-ᇿ㄰-㆏ꥠ-꥿가-퟿]/;
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
  if (HANGUL.test(value)) return NONE;
  if (!HAS_LATIN_WORDS.test(value)) return NONE;

  // 폰 키보드는 `'` 대신 `’`(U+2019) 를 넣는다. 정규식은 전부 `'` 로 썼으므로
  // 그대로 두면 **"I don’t want to live anymore" 가 통째로 안 걸린다** —
  // 같은 문장의 곧은 아포스트로피 판은 검사 코퍼스에 있어 초록불이었다.
  const normalized = value.replace(/[‘’ʼ]/gu, "'");
  const residue = stripBenignIdioms(normalized);

  /**
   * **부정된 절만 덜어내고 나머지는 원문 그대로 본다.**
   *
   * 절마다 따로 판정하지 않는 이유: 패턴 중에는 절 경계를 넘어야 맞는 것이 있다.
   *
   *     "My sister, who is 28, is suicidal"
   *     "My husband, after the fight, said he wants to kill himself"
   *
   * 쉼표로 쪼갠 뒤 다시 이으면 주어와 서술 사이에 마침표가 생기고,
   * THIRD_PARTY_SELF_HARM 의 `[^.!?]{0,50}` 간격이 그 마침표에서 끊겨 통째로
   * 실패한다. 그래서 **지울 절이 하나도 없으면 원문을 그대로** 넘긴다 —
   * 오늘 대부분의 문장이 이 길로 간다.
   */
  const clauses = clausesOf(residue);
  const kept = clauses.filter((c) => !matchesAny(NEGATED_OR_HYPOTHETICAL, c));
  if (kept.length === 0) return NONE;
  const evaluated = kept.length === clauses.length ? residue : kept.join(". ");

  const thirdParty = matchesAny(THIRD_PARTY_SELF_HARM, evaluated);
  // 3인칭이 분명하면 1인칭 자해로 세지 않는다 — 한국어 쪽 `thirdPartyOnly` 와 같은 규칙.
  const selfHarm = !thirdParty && matchesAny(FIRST_PERSON_SELF_HARM, evaluated);

  return {
    selfHarm,
    thirdPartySelfHarm: thirdParty,
    interpersonalDanger: matchesAny(INTERPERSONAL_DANGER, evaluated),
  };
}
