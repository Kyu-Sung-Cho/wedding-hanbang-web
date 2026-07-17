export type AmoraCrisisKind = "self_harm" | "interpersonal_danger" | "combined";

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
const INTERPERSONAL_DANGER_RESPONSE = [
  "지금은 안전이 가장 중요해요. 아모라는 위기 상담기관이 아니어서, 지금은 사람의 즉각적인 도움이 필요해요.",
  "당장 위험하거나 다쳤다면 이동이 더 위험하지 않을 때 안전한 곳으로 이동하고 경찰 112 또는 소방 119에 바로 전화하세요.",
  "여성 피해 지원이 필요하면 여성긴급전화 1366에서 365일 24시간 상담받을 수 있어요.",
  OUTSIDE_KOREA_GUIDANCE,
].join("\n\n");
const COMBINED_RESPONSE = [
  "지금 이 말을 혼자 감당하지 않아도 돼요. 아모라는 위기 상담기관이 아니어서, 지금은 사람의 즉각적인 도움이 필요해요.",
  "당장 위험하거나 이미 다쳤다면 이동이 더 위험하지 않을 때 안전한 곳으로 이동하고 경찰 112 또는 소방 119에 바로 전화하세요. 가능하다면 혼자 있지 말고 믿을 수 있는 사람과 함께 있어주세요.",
  "한국의 자살예방상담전화 109는 24시간 연결돼요. 여성 피해 지원이 필요하면 여성긴급전화 1366에서 365일 24시간 상담받을 수 있어요.",
  OUTSIDE_KOREA_GUIDANCE,
].join("\n\n");

export function buildAmoraCrisisResponse(kind: AmoraCrisisKind): string {
  if (kind === "self_harm") return SELF_HARM_RESPONSE;
  if (kind === "interpersonal_danger") return INTERPERSONAL_DANGER_RESPONSE;
  return COMBINED_RESPONSE;
}

function normalizeForCrisisClassification(value: string): string {
  return value
    .normalize("NFKC")
    // Remove invisible formatting/joiner controls that can split a safety
    // phrase without changing what the user sees. NFKC runs first so
    // compatibility forms cannot preserve a bypassing representation.
    .replace(/[\p{Cf}\u034F\u180B-\u180F\uFE00-\uFE0F]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

const META_DISCUSSION_PATTERN =
  /(?:(?:라는|이라고|라고|다는)\s*(?:말|문구|표현|단어|대사|가사|예시|질문)|(?:번역|검토|뜻|의미|예방|캠페인|교육|기사|뉴스|소설|영화|드라마|논문|콘텐츠|장면|정책|비평|법적))/;
const SELF_HARM_PATTERNS = [
  /죽\s*고\s*싶/,
  /살(?:고|기)\s*싶지\s*않|살기\s*싫/,
  /자살(?:하|을|하고\s*싶)/,
  /자해(?:하|할|하고\s*싶)/,
  /목숨을?\s*끊(?:을|으려|겠)/,
  /극단적\s*선택을?\s*(?:하|할)/,
  /죽으려고\s*.{0,30}(?:약을?\s*먹|뛰어내리|목을?\s*매)/,
  /손목을?\s*그었/,
  /죽어\s*버릴\s*(?:거|꺼|게)/,
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
const FIRST_PERSON_SELF_HARM_PATTERN =
  /(?:^|[\s,.!?])(?:나|난|나는|내가|저|전|저는|제가|나도|저도)\s*.{0,30}(?:죽\s*고\s*싶|살(?:고|기)\s*싶지\s*않|살기\s*싫|자살|자해|목숨을?\s*끊|극단적\s*선택|죽으려고|손목을?\s*그었|죽어\s*버릴)/;
const THIRD_PARTY_SELF_HARM_PATTERN =
  /(?:(?:친구|지인|동생|형|누나|언니|오빠|엄마|아빠|부모님|신랑|신부|배우자|남편|아내|남자친구|여자친구|상대|그|그녀|주인공|고객|사용자|내담자)(?:가|이|는|은|도)|누가|누군가|사람이)\s*.{0,50}(?:죽\s*고\s*싶|살(?:고|기)\s*싶지\s*않|살기\s*싫|자살|자해|목숨을?\s*끊|극단적\s*선택|죽으려고|손목을?\s*그었|죽어\s*버릴)/;
const CURRENT_INTERPERSONAL_DANGER_PATTERNS = [
  /(?:^|[\s,.!?])나(?:를)?\s*.{0,30}(?:때리|폭행|죽이|죽일|죽여|해치)/,
  /(?:배우자|남편|아내|남자친구|여자친구|신랑|신부|상대|그\s*사람)(?:에게|한테)\s*맞(?:았|고|는)/,
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
  /문을?\s*부수/,
] as const;
const SEGMENT_BOUNDARY_PATTERN = /(?:[\n.!?;,]+|하지만|그런데|근데|말고|아니라)/;

function matchesAny(patterns: readonly RegExp[], value: string): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

export function classifyAmoraCrisis(
  userText: string,
): AmoraCrisisClassification | null {
  const text = normalizeForCrisisClassification(userText);
  let selfHarm = false;
  let interpersonalDanger = false;

  for (const segment of text.split(SEGMENT_BOUNDARY_PATTERN)) {
    const candidate = segment.trim();
    if (!candidate || META_DISCUSSION_PATTERN.test(candidate)) continue;

    const directSelfHarm =
      matchesAny(SELF_HARM_PATTERNS, candidate)
      && !matchesAny(SELF_HARM_NEGATION_PATTERNS, candidate);
    const thirdPartyOnly =
      THIRD_PARTY_SELF_HARM_PATTERN.test(candidate)
      && !FIRST_PERSON_SELF_HARM_PATTERN.test(candidate);
    if (directSelfHarm && !thirdPartyOnly) selfHarm = true;
    if (matchesAny(CURRENT_INTERPERSONAL_DANGER_PATTERNS, candidate)) {
      interpersonalDanger = true;
    }
  }

  if (selfHarm && interpersonalDanger) return { kind: "combined" };
  if (selfHarm) return { kind: "self_harm" };
  if (interpersonalDanger) return { kind: "interpersonal_danger" };
  return null;
}
