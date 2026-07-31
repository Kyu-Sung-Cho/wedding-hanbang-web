export type AmoraCrisisKind =
  | "self_harm"
  | "third_party_self_harm"
  | "interpersonal_danger"
  | "combined";

export interface AmoraCrisisClassification {
  kind: AmoraCrisisKind;
}

export const AMORA_CRISIS_CONTACT_POLICY_VERSION =
  "kr_109_112_119_1366_2026-07-16";

// Official Korean contact facts were rechecked on 2026-07-16. Any contact
// change must update these fixed responses, their tests, and the persisted
// safety_contact_policy version together.
const OUTSIDE_KOREA_GUIDANCE =
  "한국 밖에 있다면 현지 긴급번호 또는 지역 위기상담기관에 바로 연락해주세요.";
const SELF_HARM_RESPONSE = [
  "지금 이 말을 혼자 감당하지 않아도 돼요. 아모라는 위기 상담기관이 아니어서, 지금은 사람의 즉각적인 도움이 필요해요.",
  "지금 당장 다칠 가능성이 있거나 이미 행동했다면 경찰 112 또는 소방 119에 바로 전화하세요. 가능하다면 혼자 있지 말고 위험한 물건이나 장소에서 벗어나 믿을 수 있는 사람과 함께 있어주세요.",
  "한국의 자살예방상담전화 109는 24시간 연결돼요.",
  OUTSIDE_KOREA_GUIDANCE,
].join("\n\n");
const THIRD_PARTY_SELF_HARM_RESPONSE = [
  "말해줘서 잘했어요. 지금은 그 사람의 안전을 혼자 책임지려 하지 말고, 즉시 사람의 도움을 연결해야 해요. 아모라는 위기 상담기관이 아니에요.",
  "이미 약을 먹었거나 다쳤거나 곧 행동할 가능성이 있다면 경찰 112 또는 소방 119에 바로 전화하세요. 본인의 안전을 지킬 수 있는 범위에서 혼자 두지 말고, 위험한 물건이나 장소에서 거리를 두게 하며 믿을 수 있는 어른이나 보호자에게도 바로 알려주세요.",
  "한국의 자살예방상담전화 109는 24시간 연결돼요. 가능하면 함께 전화하거나, 109에 지금 어떻게 도와야 하는지 물어보세요.",
  OUTSIDE_KOREA_GUIDANCE,
].join("\n\n");
const INTERPERSONAL_DANGER_RESPONSE = [
  "지금은 본인과 다른 사람 모두의 안전이 가장 중요해요. 아모라는 위기 상담기관이 아니어서, 지금은 사람의 즉각적인 도움이 필요해요.",
  "누군가를 위협하고 있거나 위협받는 중이라면 위험한 물건에서 떨어져 서로 거리를 두고, 직접 맞서거나 따라가지 마세요. 당장 위험하거나 다쳤다면 안전한 곳에서 경찰 112 또는 소방 119에 바로 전화하세요.",
  "본인이 여성폭력 피해 지원이 필요하면 여성긴급전화 1366에서 365일 24시간 상담받을 수 있어요.",
  OUTSIDE_KOREA_GUIDANCE,
].join("\n\n");
const COMBINED_RESPONSE = [
  "지금 이 말을 혼자 감당하지 않아도 돼요. 아모라는 위기 상담기관이 아니어서, 지금은 사람의 즉각적인 도움이 필요해요.",
  "본인이나 다른 사람이 당장 위험하거나 이미 다쳤다면 위험한 물건에서 떨어져 서로 거리를 두고 경찰 112 또는 소방 119에 바로 전화하세요. 가능하다면 혼자 있지 말고 믿을 수 있는 사람과 함께 있어주세요.",
  "한국의 자살예방상담전화 109는 24시간 연결돼요. 여성 피해 지원이 필요하면 여성긴급전화 1366에서 365일 24시간 상담받을 수 있어요.",
  OUTSIDE_KOREA_GUIDANCE,
].join("\n\n");

export function buildAmoraCrisisResponse(kind: AmoraCrisisKind): string {
  if (kind === "self_harm") return SELF_HARM_RESPONSE;
  if (kind === "third_party_self_harm") return THIRD_PARTY_SELF_HARM_RESPONSE;
  if (kind === "interpersonal_danger") return INTERPERSONAL_DANGER_RESPONSE;
  return COMBINED_RESPONSE;
}

export function normalizeAmoraSafetyText(value: string): string {
  return value
    .normalize("NFKC")
    // Remove invisible formatting/joiner controls that can split a safety
    // phrase without changing what the user sees. NFKC runs first so
    // compatibility forms cannot preserve a bypassing representation.
    .replace(/[\p{Cf}\u034F\u180B-\u180F\uFE00-\uFE0F]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

const EXPLICIT_META_DISCUSSION_PATTERN =
  /(?:(?:라는|이라고|라고|다는)\s*(?:말|문구|표현|단어|대사|가사|예시|질문)|["“][^"”\n]{1,120}["”]\s*(?:는|은)\s*(?:협박\s*)?(?:말|문구|표현|단어|대사|가사|예시|질문))/;
const META_CONTEXT_PATTERN =
  /(?:(?:기사|뉴스).{0,80}(?:사건|보도|기사|내용)|(?:사건|보도|기사|내용).{0,80}(?:기사|뉴스)|(?:소설|영화|드라마|콘텐츠).{0,80}(?:주인공|등장인물|장면|대사|내용)|(?:주인공|등장인물|장면|대사|내용).{0,80}(?:소설|영화|드라마|콘텐츠)|(?:논문|교육|캠페인|정책|비평).{0,80}(?:사례|예시|문구|표현|분석|연구|내용)|(?:사례|예시|문구|표현|분석|연구|내용).{0,80}(?:논문|교육|캠페인|정책|비평))/;
const FICTIONAL_GAME_CONTEXT_PATTERN = /게임(?:에서|하다가|중에|속에서)?/;
const REAL_WORLD_OVERRIDE_PATTERN =
  /(?:진짜|현실|실제로|지금|현재|칼|흉기|때리|맞고|폭행|협박|위협)/;
const CURRENT_DISCLOSURE_SIGNAL_PATTERN =
  /(?:(?:지금|오늘|방금|현재)\s*.{0,60}(?:죽|자살|자해|목숨|극단적|때리|맞고|폭행|협박|위협|감금|스토킹|성폭|성추행|성범죄|강간|약을?\s*(?:먹|삼키)|타이레놀|아세트아미노펜|농약|락스|표백제|세제|부동액|번개탄|연탄|뛰어내|칼|흉기)|(?:오히려|도리어)\s*.{0,40}(?:죽|자살|자해|목숨|극단적)|(?:나|난|나는|내가|저|전|저는|제가|남편|아내|배우자|남자친구|여자친구|신랑|신부|상대)\s*.{0,40}(?:지금|오늘|방금|현재|맞고\s*있|당하고\s*있|협박받고\s*있)|(?:칼|흉기|위험한\s*물건)\s*.{0,30}(?:들고\s*있|쥐고\s*있|휘두르)|(?:살려\s*줘|도와\s*줘))/;
const COLLOQUIAL_SELF_HARM_PATTERNS = [
  /그만\s*살고\s*싶/,
  /죽고만\s*싶/,
  /(?:차라리\s*)?사라지고\s*싶/,
  /살고\s*싶은\s*마음(?:이|은)?\s*(?:하나도\s*)?없/,
] as const;
const COLLOQUIAL_SELF_HARM_NEGATION_PATTERNS = [
  /그만\s*살고\s*싶은\s*(?:건|것은)\s*아니/,
  /죽고만\s*싶지\s*않/,
  /죽고만\s*싶은\s*(?:건|것은)\s*아니/,
  /(?:차라리\s*)?사라지고\s*싶지\s*않/,
  /(?:차라리\s*)?사라지고\s*싶은\s*(?:건|것은)\s*아니/,
  /살고\s*싶은\s*마음(?:이|은)?\s*없(?:는\s*(?:건|것은)\s*아니|지\s*않)/,
] as const;
const HYPOTHETICAL_COLLOQUIAL_SELF_HARM_PATTERN =
  /(?:그만\s*살고\s*싶|죽고만\s*싶|(?:차라리\s*)?사라지고\s*싶|살고\s*싶은\s*마음(?:이|은)?\s*(?:하나도\s*)?없).{0,16}(?:다면|으면|면|경우)/;
const FIRST_PERSON_COLLOQUIAL_SELF_HARM_PATTERN =
  /(?:^|[\s,.!?])(?:나|난|나는|내가|저|전|저는|제가|나도|저도)\s*.{0,30}(?:그만\s*살고\s*싶|죽고만\s*싶|(?:차라리\s*)?사라지고\s*싶|살고\s*싶은\s*마음(?:이|은)?\s*(?:하나도\s*)?없)/;
const THIRD_PARTY_COLLOQUIAL_SELF_HARM_PATTERN =
  /(?:(?:친구|지인|동생|형|누나|언니|오빠|엄마|아빠|부모님|신랑|신부|배우자|남편|아내|남자친구|여자친구|상대|그|그녀|주인공|고객|사용자|내담자)(?:가|이|는|은|도)|누가|누군가|사람이)\s*.{0,50}(?:그만\s*살고\s*싶|죽고만\s*싶|(?:차라리\s*)?사라지고\s*싶|살고\s*싶은\s*마음(?:이|은)?\s*(?:하나도\s*)?없)/;
const HIGH_RISK_DRUG_DUMP_ATTEMPT_PATTERN =
  /(?:수면제|진통제|타이레놀|아세트아미노펜|약|알약)(?:을|를)?\s*(?:한꺼번에|왕창|잔뜩|몽땅|한\s*(?:움큼|줌))(?:을|를)?\s*(?:입(?:안)?에\s*)?털어\s*넣/;
const HIGH_RISK_DRUG_DUMP_ATTEMPT_NEGATION_PATTERN =
  /(?:수면제|진통제|타이레놀|아세트아미노펜|약|알약)(?:을|를)?\s*(?:한꺼번에|왕창|잔뜩|몽땅|한\s*(?:움큼|줌))(?:을|를)?\s*(?:입(?:안)?에\s*)?털어\s*넣(?:지\s*않|은\s*(?:건|것은)\s*아니)/;
const FIRST_PERSON_HIGH_RISK_DRUG_DUMP_ATTEMPT_PATTERN =
  /(?:^|[\s,.!?])(?:나|난|나는|내가|저|전|저는|제가|나도|저도)\s*.{0,50}(?:수면제|진통제|타이레놀|아세트아미노펜|약|알약)(?:을|를)?\s*(?:한꺼번에|왕창|잔뜩|몽땅|한\s*(?:움큼|줌))(?:을|를)?\s*(?:입(?:안)?에\s*)?털어\s*넣/;
const THIRD_PARTY_HIGH_RISK_DRUG_DUMP_ATTEMPT_PATTERN =
  /(?:(?:친구|지인|동생|형|누나|언니|오빠|엄마|아빠|부모님|신랑|신부|배우자|남편|아내|남자친구|여자친구|상대|그|그녀|주인공|고객|사용자|내담자)(?:가|이|는|은|도)|누가|누군가|사람이)\s*.{0,70}(?:수면제|진통제|타이레놀|아세트아미노펜|약|알약)(?:을|를)?\s*(?:한꺼번에|왕창|잔뜩|몽땅|한\s*(?:움큼|줌))(?:을|를)?\s*(?:입(?:안)?에\s*)?털어\s*넣/;
const FIRST_PERSON_REPORTING_THIRD_PARTY_COLLOQUIAL_RISK_PATTERN =
  /(?:^|[\s,.!?])(?:나|난|나는|내가|저|전|저는|제가|나도|저도)\s*.{0,20}(?:(?:친구|지인|동생|형|누나|언니|오빠|엄마|아빠|부모님|신랑|신부|배우자|남편|아내|남자친구|여자친구|상대|그|그녀|주인공|고객|사용자|내담자)(?:가|이|는|은|도)|누가|누군가|사람이)\s*.{0,70}(?:그만\s*살고\s*싶|죽고만\s*싶|(?:차라리\s*)?사라지고\s*싶|살고\s*싶은\s*마음(?:이|은)?\s*(?:하나도\s*)?없|(?:수면제|진통제|타이레놀|아세트아미노펜|약|알약)(?:을|를)?\s*(?:한꺼번에|왕창|잔뜩|몽땅|한\s*(?:움큼|줌))(?:을|를)?\s*(?:입(?:안)?에\s*)?털어\s*넣)/;
const SELF_HARM_PATTERNS = [
  /죽\s*고\s*싶/,
  /살(?:고|기)\s*싶지\s*않|살기\s*싫/,
  /자살(?:하|을|하고\s*싶)/,
  /자해(?:하|할|하고\s*싶)/,
  /목숨을?\s*끊(?:고\s*싶|을|으려|겠)/,
  /극단적\s*선택을?\s*(?:하|할)/,
  /죽으려고\s*.{0,30}(?:약을?\s*먹|뛰어내리|목을?\s*매)/,
  /손목을?\s*그었/,
  /죽어\s*버릴\s*(?:래|거|꺼|게)/,
  /죽\s*을\s*(?:래|거야)/,
  /죽으려고\s*(?:해|했|하는|했었|했어요|해요|요)/,
  /(?:죽\s*을|자살)\s*생각(?:이|을)?\s*(?:들|나|있|했)/,
  /(?:죽\s*을|자살)\s*생각이?(?:에요|예요|야|입니다)/,
  /죽어야\s*(?:겠|할\s*것\s*같)/,
  /죽어\s*버리(?:고\s*싶|겠|려)/,
  /목숨을?\s*끊어\s*버리(?:고\s*싶|겠|려)/,
] as const;
const SELF_HARM_ATTEMPT_PATTERNS = [
  /(?:수면제|진통제|타이레놀|아세트아미노펜|약|알약)(?:을|를)?\s*(?:한\s*(?:통|병)|[1-9]\d{1,}\s*알|여러\s*알|전부|모두|다|몽땅|너무\s*많이|많이|과다(?:로)?|과량(?:으로)?)(?:을|를)?\s*(?:먹|삼(?:키|켰)|복용)/,
  /(?:수면제|진통제|타이레놀|아세트아미노펜|약|알약)(?:을|를)?\s*(?:한꺼번에|왕창|잔뜩|한\s*(?:움큼|줌)|(?:열|열다섯|스무|스물|서른|마흔|쉰|예순|일흔|여든|아흔)\s*(?:알|개)|[1-9]\d{1,}\s*개)(?:을|를)?\s*(?:먹|삼(?:키|켰)|복용)/,
  /(?:수면제|진통제|타이레놀|아세트아미노펜|약|알약)(?:을|를)?\s*(?:과다|과량)\s*복용/,
  /(?:농약|락스|표백제|세제|부동액)(?:을|를)?\s*(?:마시|마셨|마셔|먹|삼(?:키|켰))/,
  /(?:번개탄|연탄)(?:을|를)?\s*(?:피우|피웠|피워|피운|피울|붙이|붙였|점화|켜)/,
  /목(?:을)?\s*(?:매|맸|맨|매달)/,
  /(?:옥상|난간|다리|베란다|한강)\s*.{0,30}(?:뛰어내(?:리|릴|린|렸|려)|몸을\s*던(?:지|질|진|졌|지려))/,
  /손목을?\s*(?:그었|긋|베었)/,
  HIGH_RISK_DRUG_DUMP_ATTEMPT_PATTERN,
] as const;
const SELF_HARM_EMERGENCY_OUTCOME_PATTERNS = [
  /(?:수면제|진통제|타이레놀|아세트아미노펜|약|알약)(?:을|를)?\s*(?:먹|삼(?:키|켰)|복용).{0,30}(?:의식(?:이)?\s*없|깨(?:지)?\s*않|쓰러|반응(?:이)?\s*없)/,
] as const;
const SELF_HARM_NEGATION_PATTERNS = [
  /죽\s*고\s*싶지\s*않/,
  /죽\s*고\s*싶은\s*(?:건|것은)\s*아니/,
  /자살(?:하고)?\s*싶지\s*않/,
  /자해(?:하고)?\s*싶지\s*않/,
  /자살하지\s*않/,
  /자해하지\s*않/,
  /목숨을?\s*끊지\s*않/,
  /극단적\s*선택을?\s*하지\s*않/,
] as const;
const SELF_HARM_ATTEMPT_NEGATION_PATTERNS = [
  /(?:수면제|진통제|타이레놀|아세트아미노펜|약|알약)(?:을|를)?\s*(?:한\s*(?:통|병)|[1-9]\d{1,}\s*알|여러\s*알|전부|모두|다|몽땅|너무\s*많이|많이|과다(?:로)?|과량(?:으로)?)(?:을|를)?\s*(?:먹|삼(?:키|켰)|복용)(?:지\s*않|은\s*(?:건|것은)\s*아니)/,
  /(?:수면제|진통제|타이레놀|아세트아미노펜|약|알약)(?:을|를)?\s*(?:한꺼번에|왕창|잔뜩|한\s*(?:움큼|줌)|(?:열|열다섯|스무|스물|서른|마흔|쉰|예순|일흔|여든|아흔)\s*(?:알|개)|[1-9]\d{1,}\s*개)(?:을|를)?\s*(?:먹|삼(?:키|켰)|복용)(?:지\s*않|은\s*(?:건|것은)\s*아니)/,
  /(?:농약|락스|표백제|세제|부동액)(?:을|를)?\s*(?:(?:마시|먹|삼키)지\s*않|(?:마신|먹은|삼킨)\s*(?:건|것은)\s*아니)/,
  /(?:번개탄|연탄)(?:을|를)?\s*(?:(?:피우|피워(?:놓)?|붙이|점화하|켜)지\s*않|(?:피운|피워놓은|붙인|점화한|켠)\s*(?:건|것은)\s*아니)/,
  /목(?:을)?\s*(?:매|매달)지\s*않/,
  /(?:옥상|난간|다리|베란다|한강)\s*.{0,30}(?:(?:뛰어내리|몸을\s*던지)지\s*않|(?:뛰어내리|몸을\s*던지)려는\s*(?:건|것은)\s*아니)/,
  HIGH_RISK_DRUG_DUMP_ATTEMPT_NEGATION_PATTERN,
] as const;
const HYPOTHETICAL_SELF_HARM_ATTEMPT_PATTERN =
  /(?:먹|삼(?:키|켰)|복용|마(?:시|셨|셔)|피(?:우|웠|워|운|울)|붙(?:이|였)|점화(?:하|했)|켜|켰|털어\s*넣|목(?:을)?\s*(?:매|매달)|뛰어내(?:리|릴|린)|몸을\s*던(?:지|질|진)).{0,16}(?:면|다면|경우)/;
const FIRST_PERSON_SELF_HARM_PATTERN =
   /(?:^|[\s,.!?])(?:나|난|나는|내가|저|전|저는|제가|나도|저도)\s*.{0,30}(?:죽\s*고\s*싶|죽\s*을\s*(?:래|거야)|죽어야\s*(?:겠|할\s*것\s*같)|죽어\s*버리|살(?:고|기)\s*싶지\s*않|살기\s*싫|자살|자해|목숨을?\s*끊|극단적\s*선택|죽으려고|손목을?\s*그었)/;
const FIRST_PERSON_SELF_HARM_ATTEMPT_PATTERN =
  /(?:^|[\s,.!?])(?:나|난|나는|내가|저|전|저는|제가|나도|저도)\s*.{0,50}(?:(?:수면제|진통제|타이레놀|아세트아미노펜|약|알약)(?:을|를)?\s*(?:한\s*(?:통|병)|[1-9]\d{1,}\s*알|여러\s*알|전부|모두|다|몽땅|너무\s*많이|많이|과다(?:로)?|과량(?:으로)?)(?:을|를)?\s*(?:먹|삼(?:키|켰)|복용)|(?:농약|락스|표백제)(?:을|를)?\s*(?:마시|마셨|마셔|먹|삼(?:키|켰))|번개탄(?:을|를)?\s*(?:피우|피웠|붙이|붙였|점화|켜)|목(?:을)?\s*(?:매|맸|맨|매달)|(?:옥상|난간|다리|베란다|한강)\s*.{0,20}(?:뛰어내(?:리|릴|린|렸|려)|몸을\s*던(?:지|질|진|졌|지려))|손목을?\s*(?:그었|긋|베었))/;
const FIRST_PERSON_EXPANDED_ATTEMPT_PATTERN =
  /(?:^|[\s,.!?])(?:나|난|나는|내가|저|전|저는|제가|나도|저도)\s*.{0,50}(?:(?:수면제|진통제|타이레놀|아세트아미노펜|약|알약)(?:을|를)?\s*(?:한꺼번에|왕창|잔뜩|한\s*(?:움큼|줌)|(?:열|열다섯|스무|스물|서른|마흔|쉰|예순|일흔|여든|아흔)\s*(?:알|개)|[1-9]\d{1,}\s*개)(?:을|를)?\s*(?:먹|삼(?:키|켰)|복용)|(?:농약|락스|표백제|세제|부동액)(?:을|를)?\s*(?:마시|마셨|마셔|먹|삼(?:키|켰))|(?:번개탄|연탄)(?:을|를)?\s*(?:피우|피웠|피워|피운|피울|붙이|붙였|점화|켜))/;
const THIRD_PARTY_SELF_HARM_PATTERN =
   /(?:(?:친구|지인|동생|형|누나|언니|오빠|엄마|아빠|부모님|신랑|신부|배우자|남편|아내|남자친구|여자친구|상대|그|그녀|주인공|고객|사용자|내담자)(?:가|이|는|은|도)|누가|누군가|사람이)\s*.{0,50}(?:죽\s*고\s*싶|죽\s*을\s*(?:래|거야)|죽어야\s*(?:겠|할\s*것\s*같)|죽어\s*버리|살(?:고|기)\s*싶지\s*않|살기\s*싫|자살|자해|목숨을?\s*끊|극단적\s*선택|죽으려고|손목을?\s*그었)/;
const THIRD_PARTY_SELF_HARM_ATTEMPT_PATTERN =
  /(?:(?:친구|지인|동생|형|누나|언니|오빠|엄마|아빠|부모님|신랑|신부|배우자|남편|아내|남자친구|여자친구|상대|그|그녀|주인공|고객|사용자|내담자)(?:가|이|는|은|도)|누가|누군가|사람이)\s*.{0,70}(?:(?:수면제|진통제|타이레놀|아세트아미노펜|약|알약)(?:을|를)?\s*(?:한\s*(?:통|병)|[1-9]\d{1,}\s*알|여러\s*알|전부|모두|다|몽땅|너무\s*많이|많이|과다(?:로)?|과량(?:으로)?)(?:을|를)?\s*(?:먹|삼(?:키|켰)|복용)|(?:농약|락스|표백제)(?:을|를)?\s*(?:마시|마셨|마셔|먹|삼(?:키|켰))|번개탄(?:을|를)?\s*(?:피우|피웠|붙이|붙였|점화|켜)|목(?:을)?\s*(?:매|맸|맨|매달)|(?:옥상|난간|다리|베란다|한강)\s*.{0,20}(?:뛰어내(?:리|릴|린|렸|려)|몸을\s*던(?:지|질|진|졌|지려))|손목을?\s*(?:그었|긋|베었))/;
const THIRD_PARTY_EMERGENCY_OUTCOME_PATTERN =
  /(?:(?:친구|지인|동생|형|누나|언니|오빠|엄마|아빠|부모님|신랑|신부|배우자|남편|아내|남자친구|여자친구|상대|그|그녀)(?:가|이|는|은|도)|누군가|사람이)\s*.{0,70}(?:수면제|진통제|타이레놀|아세트아미노펜|약|알약)(?:을|를)?\s*(?:먹|삼(?:키|켰)|복용).{0,30}(?:의식(?:이)?\s*없|깨(?:지)?\s*않|쓰러|반응(?:이)?\s*없)/;
const THIRD_PARTY_EXPANDED_ATTEMPT_PATTERN =
  /(?:(?:친구|지인|동생|형|누나|언니|오빠|엄마|아빠|부모님|신랑|신부|배우자|남편|아내|남자친구|여자친구|상대|그|그녀|주인공|고객|사용자|내담자)(?:가|이|는|은|도)|누가|누군가|사람이)\s*.{0,70}(?:(?:수면제|진통제|타이레놀|아세트아미노펜|약|알약)(?:을|를)?\s*(?:한꺼번에|왕창|잔뜩|한\s*(?:움큼|줌)|(?:열|열다섯|스무|스물|서른|마흔|쉰|예순|일흔|여든|아흔)\s*(?:알|개)|[1-9]\d{1,}\s*개)(?:을|를)?\s*(?:먹|삼(?:키|켰)|복용)|(?:농약|락스|표백제|세제|부동액)(?:을|를)?\s*(?:마시|마셨|마셔|먹|삼(?:키|켰))|(?:번개탄|연탄)(?:을|를)?\s*(?:피우|피웠|피워|피운|피울|붙이|붙였|점화|켜))/;
const REAL_THIRD_PARTY_SELF_HARM_PATTERN =
   /(?:(?:친구|지인|동생|형|누나|언니|오빠|엄마|아빠|부모님|신랑|신부|배우자|남편|아내|남자친구|여자친구|상대|그|그녀)(?:가|이|는|은|도)|누군가|사람이)\s*.{0,70}(?:죽\s*고\s*싶|죽\s*을\s*(?:래|거야)|죽어야\s*(?:겠|할\s*것\s*같)|죽어\s*버리|살(?:고|기)\s*싶지\s*않|살기\s*싫|자살|자해|목숨을?\s*끊|극단적\s*선택|죽으려고|손목을?\s*그었|약을?\s*(?:먹|삼키))/;
const REAL_THIRD_PARTY_SELF_HARM_ATTEMPT_PATTERN =
  /(?:(?:친구|지인|동생|형|누나|언니|오빠|엄마|아빠|부모님|신랑|신부|배우자|남편|아내|남자친구|여자친구|상대|그|그녀)(?:가|이|는|은|도)|누군가|사람이)\s*.{0,70}(?:(?:수면제|진통제|타이레놀|아세트아미노펜|약|알약)(?:을|를)?\s*(?:한\s*(?:통|병)|[1-9]\d{1,}\s*알|여러\s*알|전부|모두|다|몽땅|너무\s*많이|많이|과다(?:로)?|과량(?:으로)?)(?:을|를)?\s*(?:먹|삼(?:키|켰)|복용)|(?:농약|락스|표백제)(?:을|를)?\s*(?:마시|마셨|마셔|먹|삼(?:키|켰))|번개탄(?:을|를)?\s*(?:피우|피웠|붙이|붙였|점화|켜)|목(?:을)?\s*(?:매|맸|맨|매달)|(?:옥상|난간|다리|베란다|한강)\s*.{0,20}(?:뛰어내(?:리|릴|린|렸|려)|몸을\s*던(?:지|질|진|졌|지려))|손목을?\s*(?:그었|긋|베었))/;
const REAL_THIRD_PARTY_EXPANDED_ATTEMPT_PATTERN =
  /(?:(?:친구|지인|동생|형|누나|언니|오빠|엄마|아빠|부모님|신랑|신부|배우자|남편|아내|남자친구|여자친구|상대|그|그녀)(?:가|이|는|은|도)|누군가|사람이)\s*.{0,70}(?:(?:수면제|진통제|타이레놀|아세트아미노펜|약|알약)(?:을|를)?\s*(?:한꺼번에|왕창|잔뜩|한\s*(?:움큼|줌)|(?:열|열다섯|스무|스물|서른|마흔|쉰|예순|일흔|여든|아흔)\s*(?:알|개)|[1-9]\d{1,}\s*개)(?:을|를)?\s*(?:먹|삼(?:키|켰)|복용)|(?:농약|락스|표백제|세제|부동액)(?:을|를)?\s*(?:마시|마셨|마셔|먹|삼(?:키|켰))|(?:번개탄|연탄)(?:을|를)?\s*(?:피우|피웠|피워|피운|피울|붙이|붙였|점화|켜))/;
const HYPOTHETICAL_THIRD_PARTY_PATTERN =
  /(?:죽\s*고\s*싶|자살|자해|목숨을?\s*끊|극단적\s*선택).{0,40}(?:라고\s*)?(?:말하|얘기하|고백하)?.{0,12}(?:면|다면|경우)/;
const CURRENT_INTERPERSONAL_DANGER_PATTERNS = [
  /(?:^|[\s,.!?])나(?:를)?\s*.{0,30}(?:때리|폭행|죽이|죽일|죽여|해치)/,
  /(?:배우자|남편|아내|남자친구|여자친구|신랑|신부|상대|그\s*사람)(?:에게|한테)\s*맞(?:았|아|고|는)/,
  /(?:배우자|남편|아내|남자친구|여자친구|신랑|신부|상대)(?:가|이)\s*.{0,30}(?:폭력|폭행|때리)\s*.{0,20}(?:있|쓰|해|했)/,
  /(?:지금|계속)\s*.{0,20}(?:맞고\s*있|폭행을?\s*당)/,
  /(?:가정폭력|데이트폭력|폭행)(?:을|를)?\s*당/,
  /(?:배우자|남편|아내|남자친구|여자친구|신랑|신부|상대)(?:가|이)\s*.{0,20}(?:칼|흉기)\s*.{0,20}(?:들고|꺼내)/,
  /(?:칼|흉기)\s*.{0,40}(?:협박|위협|죽이겠|해치겠)/,
  /(?:죽이겠|해치겠)\s*.{0,30}(?:협박|위협)/,
  /감금(?:됐|당|하)/,
  /못\s*나가게\s*해/,
  /스토킹\s*.{0,50}(?:지금|집\s*앞|찾아왔|따라오|중)/,
  /(?:성폭행|성폭력|성추행|강간)(?:을|를)?\s*(?:당|피해)/,
  /강제로\s*성관계\s*.{0,40}(?:요구|위협|강요)/,
  /(?:협박|위협)(?:을)?\s*받\s*.{0,20}(?:있|았)/,
  /(?:^|[\s,.!?])나(?:에게|를)\s*.{0,30}(?:협박|위협)/,
  /(?:계속\s*)?협박하(?:고\s*있|는\s*중)/,
  /성범죄(?:를|을)?\s*당(?:하고\s*있|했|하)/,
  /성범죄\s*피해를?\s*입/,
  /(?:배우자|남편|아내|남자친구|여자친구|신랑|신부|상대)(?:가|이)\s*.{0,30}(?:협박|위협)\s*중/,
  /(?:배우자|남편|아내|남자친구|여자친구|신랑|신부|상대)(?:가|이)\s*.{0,30}(?:나|저)(?:를|의)?\s*죽이려고/,
  /(?:배우자|남편|아내|남자친구|여자친구|신랑|신부|상대)(?:가|이)\s*.{0,30}목(?:을)?\s*(?:조르|조른|조여|조였|졸라|졸랐)/,
  /(?:배우자|남편|아내|남자친구|여자친구|신랑|신부|상대)(?:가|이)\s*.{0,30}성관계를?\s*(?:강요|요구)/,
  /(?:칼|흉기|위험한\s*물건)\s*.{0,30}(?:들고\s*있|쥐고\s*있|휘두르)/,
  /문을?\s*부수/,
  /(?:내|제|나의|저의)\s*목(?:을)?\s*(?:조르|조른|조여|조였|졸라|졸랐)/,
  /(?:^|[\s,.!?])(?:나|저)(?:를)?\s*(?:발로\s*(?:차|찼|걷어차|걷어찼)|주먹으로\s*(?:치|쳤|때리|때렸))/,
  /(?:배우자|남편|아내|남자친구|여자친구|신랑|신부|상대)(?:가|이)\s*(?:(?:나|저)(?:를)?\s*)?(?:발로\s*(?:차|찼|걷어차|걷어찼)|주먹으로\s*(?:치|쳤|때리|때렸))/,
  /(?:배우자|남편|아내|남자친구|여자친구|신랑|신부|상대)(?:가|이)\s*(?:(?:나|저)(?:를)?\s*)?밀치.{0,30}(?:물건|집기|가구)(?:을|를)?\s*던지/,
  /(?:배우자|남편|아내|남자친구|여자친구|신랑|신부|상대)(?:가|이)\s*(?:나|저)(?:를)?\s*밀치(?:고|며|는|고\s*있|었|쳤)/,
  /(?:칼|흉기)(?:을|를)?\s*(?:들고|쥐고).{0,30}(?:집|문)\s*앞.{0,20}(?:찾아왔|찾아온|기다리|서\s*있)/,
  /(?:내|제|나의|저의)\s*(?:위치|동선)(?:를|을)?\s*(?:추적|찾아내).{0,40}(?:집|문)\s*앞(?:에서|에)?\s*(?:기다리|서\s*있|머물)/,
  /강제로\s*(?:성적\s*)?(?:관계|성관계)(?:를|을)?\s*(?:맺|가졌|했)/,
] as const;
const CURRENT_INTERPERSONAL_DANGER_EXCLUSION_PATTERNS = [
  /(?:협박|위협)하고\s*있지\s*않/,
  /(?:협박|위협)(?:을)?\s*받고\s*있지\s*않/,
  /성범죄(?:를|을)?\s*당하고\s*있지\s*않/,
  /(?:내|제|나의|저의)\s*목(?:을)?\s*(?:조르|조이)지\s*않/,
  /(?:나|저)(?:를)?\s*(?:발로\s*(?:차|걷어차)|주먹으로\s*(?:치|때리))지\s*않/,
  /(?:배우자|남편|아내|남자친구|여자친구|신랑|신부|상대)(?:가|이)\s*(?:(?:나|저)(?:를)?\s*)?(?:발로\s*(?:차|걷어차)|주먹으로\s*(?:치|때리))지\s*않/,
  /(?:배우자|남편|아내|남자친구|여자친구|신랑|신부|상대)(?:가|이)\s*.{0,30}목(?:을)?\s*(?:조른|조였던|졸랐던)\s*(?:건|것은)\s*아니/,
  /(?:내|제|나의|저의)\s*목(?:을)?\s*(?:조른|조였던|졸랐던)\s*(?:건|것은)\s*아니/,
  /(?:나|저)(?:를)?\s*(?:발로\s*(?:찬|찼던)|주먹으로\s*(?:친|쳤던))\s*(?:건|것은)\s*아니/,
  /(?:배우자|남편|아내|남자친구|여자친구|신랑|신부|상대)(?:가|이)\s*(?:(?:나|저)(?:를)?\s*)?(?:발로\s*(?:찬|찼던)|주먹으로\s*(?:친|쳤던))\s*(?:건|것은)\s*아니/,
  /(?:배우자|남편|아내|남자친구|여자친구|신랑|신부|상대)(?:가|이)\s*.{0,30}밀친\s*(?:건|것은)\s*아니/,
  /(?:칼|흉기)(?:을|를)?\s*(?:들고|쥐고).{0,30}(?:집|문)\s*앞.{0,20}(?:찾아온|기다린|서\s*있던)\s*(?:건|것은)\s*아니/,
  /(?:내|제|나의|저의)\s*(?:위치|동선)(?:를|을)?\s*(?:추적|찾아낸).{0,40}(?:집|문)\s*앞.{0,20}(?:기다린|서\s*있던)\s*(?:건|것은)\s*아니/,
  /강제로\s*(?:성적\s*)?(?:관계|성관계)(?:를|을)?\s*(?:맺은|가진|했던)\s*(?:건|것은)\s*아니/,
  /(?:업체|회사|기관|거래처|협력사|파트너사|고객|사업\s*파트너)(?:와|하고|이랑)\s*강제로\s*관계(?:를|을)?\s*맺/,
  /게임(?:에서|속에서|중에)\s*.{0,80}(?:칼|흉기)(?:을|를)?\s*(?:들고|쥐고).{0,30}(?:집|문)\s*앞.{0,20}(?:찾아왔|찾아온|기다리|서\s*있)/,
] as const;
const SEGMENT_BOUNDARY_PATTERN = /(?:[\n.!?;,]+|하지만|그런데|근데|말고|아니라)/;

function matchesAny(patterns: readonly RegExp[], value: string): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

function removeMatchingPhrases(patterns: readonly RegExp[], value: string): string {
  return patterns.reduce(
    (current, pattern) => current.replace(new RegExp(pattern.source, `${pattern.flags}g`), " "),
    value,
  );
}

export function classifyAmoraCrisis(
  userText: string,
): AmoraCrisisClassification | null {
  const text = normalizeAmoraSafetyText(userText);
  let selfHarm = false;
  let thirdPartySelfHarm = false;
  let interpersonalDanger = false;

  for (const segment of text.split(SEGMENT_BOUNDARY_PATTERN)) {
    const candidate = segment.trim();
    if (!candidate) continue;
    if (
      FICTIONAL_GAME_CONTEXT_PATTERN.test(candidate)
      && !REAL_WORLD_OVERRIDE_PATTERN.test(candidate)
    ) continue;
    if (
      EXPLICIT_META_DISCUSSION_PATTERN.test(candidate)
      && !CURRENT_DISCLOSURE_SIGNAL_PATTERN.test(candidate)
    ) continue;
    if (
      META_CONTEXT_PATTERN.test(candidate)
      && !CURRENT_DISCLOSURE_SIGNAL_PATTERN.test(candidate)
    ) continue;

    const selfHarmEvidence = removeMatchingPhrases(
      [
        ...SELF_HARM_NEGATION_PATTERNS,
        ...COLLOQUIAL_SELF_HARM_NEGATION_PATTERNS,
        ...SELF_HARM_ATTEMPT_NEGATION_PATTERNS,
      ],
      candidate,
    );
    const colloquialSelfHarm =
      matchesAny(COLLOQUIAL_SELF_HARM_PATTERNS, selfHarmEvidence)
      && !HYPOTHETICAL_COLLOQUIAL_SELF_HARM_PATTERN.test(selfHarmEvidence);
    const directSelfHarm =
      matchesAny(SELF_HARM_PATTERNS, selfHarmEvidence)
      || colloquialSelfHarm
      || (
        (
          matchesAny(SELF_HARM_ATTEMPT_PATTERNS, selfHarmEvidence)
          || matchesAny(SELF_HARM_EMERGENCY_OUTCOME_PATTERNS, selfHarmEvidence)
        )
        && !HYPOTHETICAL_SELF_HARM_ATTEMPT_PATTERN.test(selfHarmEvidence)
      );
    const firstPersonColloquialRisk =
      (
        FIRST_PERSON_COLLOQUIAL_SELF_HARM_PATTERN.test(candidate)
        || FIRST_PERSON_HIGH_RISK_DRUG_DUMP_ATTEMPT_PATTERN.test(candidate)
      )
      && !FIRST_PERSON_REPORTING_THIRD_PARTY_COLLOQUIAL_RISK_PATTERN.test(candidate);
    const thirdPartyOnly =
      (
        THIRD_PARTY_SELF_HARM_PATTERN.test(candidate)
        || THIRD_PARTY_SELF_HARM_ATTEMPT_PATTERN.test(candidate)
        || THIRD_PARTY_EXPANDED_ATTEMPT_PATTERN.test(candidate)
        || THIRD_PARTY_EMERGENCY_OUTCOME_PATTERN.test(candidate)
        || THIRD_PARTY_COLLOQUIAL_SELF_HARM_PATTERN.test(candidate)
        || THIRD_PARTY_HIGH_RISK_DRUG_DUMP_ATTEMPT_PATTERN.test(candidate)
      )
      && !FIRST_PERSON_SELF_HARM_PATTERN.test(candidate)
      && !FIRST_PERSON_SELF_HARM_ATTEMPT_PATTERN.test(candidate)
      && !FIRST_PERSON_EXPANDED_ATTEMPT_PATTERN.test(candidate)
      && !firstPersonColloquialRisk;
    const realThirdPartyRisk =
      (
        REAL_THIRD_PARTY_SELF_HARM_PATTERN.test(candidate)
        || REAL_THIRD_PARTY_SELF_HARM_ATTEMPT_PATTERN.test(candidate)
        || REAL_THIRD_PARTY_EXPANDED_ATTEMPT_PATTERN.test(candidate)
        || THIRD_PARTY_EMERGENCY_OUTCOME_PATTERN.test(candidate)
        || THIRD_PARTY_COLLOQUIAL_SELF_HARM_PATTERN.test(candidate)
        || THIRD_PARTY_HIGH_RISK_DRUG_DUMP_ATTEMPT_PATTERN.test(candidate)
      )
      && !HYPOTHETICAL_THIRD_PARTY_PATTERN.test(candidate);
    if (directSelfHarm && thirdPartyOnly && realThirdPartyRisk) {
      thirdPartySelfHarm = true;
    } else if (directSelfHarm && !thirdPartyOnly) {
      selfHarm = true;
    }
    const interpersonalEvidence = removeMatchingPhrases(
      CURRENT_INTERPERSONAL_DANGER_EXCLUSION_PATTERNS,
      candidate,
    );
    if (matchesAny(CURRENT_INTERPERSONAL_DANGER_PATTERNS, interpersonalEvidence)) {
      interpersonalDanger = true;
    }
  }

  if (
    (selfHarm && thirdPartySelfHarm)
    || ((selfHarm || thirdPartySelfHarm) && interpersonalDanger)
  ) return { kind: "combined" };
  if (selfHarm) return { kind: "self_harm" };
  if (thirdPartySelfHarm) return { kind: "third_party_self_harm" };
  if (interpersonalDanger) return { kind: "interpersonal_danger" };
  return null;
}
