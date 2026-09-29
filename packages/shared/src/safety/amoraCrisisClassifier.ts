// Browser, native, and server must classify the same canonical disclosure.
import { withoutAmoraExcludedWeddingVideoScenes } from "./amoraSafetyContentReferences";

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

// 한국 결혼 갈등의 중심 인물인 **시댁·처가가 통째로 빠져 있었다.**
// `시어머니가 칼을 들고 저희 신혼집까지 찾아왔어요` 가 아무 데도 안 걸렸다.
// 뺀 판본으로 같은 코퍼스를 재서 확인했다 — 이 목록에서 시댁을 빼면 흉기
// 문장 둘을 잃는다(`otherInterpersonalDanger` 가 이 목록을 앞에 요구한다).
const PARTNER_PATTERN =
  /(?:예비\s*신랑|예비\s*신부|남친|여친|파트너|상대방|그\s*사람|배우자|남편|아내|남자친구|여자친구|신랑|신부|시어머니|시아버지|시부모|시댁|예비\s*시댁|장모|장인|형부|상대)/;
const KNOWN_OTHER_PATTERN =
  /(?:친구|지인|동생|형|누나|언니|오빠|엄마|아빠|부모님|시어머니|시아버지|시부모|시댁|예비\s*시댁|장모|장인|형부|처가|제부|올케|처제|매형|동서|예비\s*신랑|예비\s*신부|남친|여친|파트너|상대방|그\s*사람|배우자|남편|아내|남자친구|여자친구|신랑|신부|상대)/;
const REPORTER_TARGET_PATTERN = /(?:나|저|날|절)(?:를)?/;
// 1인칭 주어(느슨한 쪽). 경계가 없어서 `나`가 `나오`·`나중`의 첫 음절에도 걸린다.
//
// **그 느슨함을 통째로 없애면 진짜 자해 진술을 잃는다.** 실제로 그렇게 해 봤다:
// 한국어는 조사를 겹쳐 쓰고(한테+도, 에게+는, 는+요) 1인칭에 `저희`도 쓰는데,
// 조사 한 칸만 허용하는 경계 패턴이 "나한테도 자해 충동이 와요"와
// "저희도 목숨을 끊는 얘기를 했어요"를 놓쳤다. 갭을 겨냥하지 않은 자연 코퍼스
// 50문장에서 45 → 40. 게다가 잃은 문장은 파트너 레인에서 `bride_private` →
// `shared` 로 돌아가 **자해 고백이 배우자에게 보이게** 됐다.
//
// 그래서 여기는 원형 그대로 두고, 경계는 아래 `BOUNDED_REPORTER_ACTOR_PATTERN` 이
// **관용으로도 쓰이는 약한 동사에만** 건다(`reporterSelfHarm` 참고).
const REPORTER_ACTOR_PATTERN = /(?:나|난|나는|내가|나도|저|전|저는|제가|저도)/;
// 경계를 요구하는 1인칭 주어. `죽겠`처럼 **관용으로도 쓰이는** 동사에만 쓴다.
//
// `죽겠다`는 한국어에서 가장 흔한 강조 표현이라, 경계 없는 주어와 묶이면
// "드레스 나오는 날만 기다려서 설레 죽겠어"·"저녁 메뉴 고르다 배고파 죽겠어"·
// "전화가 계속 와서 정신없어 죽겠어"가 전부 자해 위기가 된다. 겨냥해 만든
// 평범한 문장 20개가 20개 모두 걸렸다.
//
// 그 오탐의 대가는 경고 한 줄이 아니다 — `planAmoraCrisisDelivery`가
// `local_safety_hold`를 내면 원문이 DB에 저장되지 않고 작성창도 복구 없이 비워져
// **사용자가 쓴 글이 사라진다.**
//
// 낱말을 하나씩 제외하지 않는다 — `나`로 시작하는 한국어 낱말에는 끝이 없다.
// 대신 조사를 달거나 경계에서 끝나야 한다는 형태 규칙을 쓴다. 같은 파일의
// `EXPLICIT_REPORTER_ACTOR_PATTERN`이 이미 쓰던 방식이다.
// 경계는 **앞뒤 양쪽에** 필요하다.
//
// 뒤만 막았을 때 `문제가`·`숙제가` 안의 `제가` 가 주어로 읽혀 "문제가 나서 죽겠어"
// 가 자해 위기가 됐다. 앞쪽 `(?<![가-힣])` 가 그것을 막는다.
//
// 조사는 겹쳐 쓴다(나+한테+도). 한 칸만 허용했더니 "나한테도 자해 충동이 와요"
// 를 놓쳤으므로 반복을 허용한다.
//
// `요` 는 **다른 조사 뒤에만** 붙인다. "나는요" 는 나+는+요 지만 "나요" 는 동사
// 나다의 활용이라, 맨 대명사 뒤의 `요` 를 허용하면 "화가 나요 진짜 죽겠어" 가
// 자해 위기가 된다. `로`·`서` 는 아예 넣지 않는다 — "나로 인해 늦어져서 미안해
// 죽겠어", "문제가 나서 죽겠어" 가 오탐이 된다. 조사 목록은 넓힐수록 평범한
// 문장을 끌어온다.
const BOUNDED_REPORTER_ACTOR_PATTERN =
  /(?<![가-힣])(?:(?:나|저)(?:(?:는|은|도|만|까지|조차|한테|에게|께|보다|부터|마저|랑|와|과|처럼|의|를|을|야)+요?)?|난|전|(?:내|제)(?:가|게|한테))(?![가-힣])/;
const EXPLICIT_REPORTER_ACTOR_PATTERN =
  /(?:^|[\s,.;!?])(?:나는|내가|나도|난|나|저는|제가|저도|전|저)(?=$|[\s,.;!?])/;
const EXPLICIT_KNOWN_OTHER_ACTOR_PATTERN = new RegExp(
  `(?:^|[\\s,.;!?])${KNOWN_OTHER_PATTERN.source}(?:가|이|는|은|도)?(?=$|[\\s,.;!?])`,
);
const HISTORICAL_MARKER_PATTERN = /(?:예전에|과거에|작년에|몇\s*년\s*전|오래전에|그때)/;
const VIOLENCE_CUE_PATTERN =
  /(?:죽이겠|죽인다고|죽여\s*버리|때리|때려|때렸|때린|팼|패고|맞았|맞고|폭력|폭행|칼로?\s*협박|협박|위협|감금|가둬|성폭행|성폭력|성추행|강간|동의\s*없이|목을?\s*조르)/;
const RESUMED_CURRENT_VIOLENCE_PATTERN =
  /(?:하지만|그런데|근데|지만).{0,24}(?:지금|현재|방금|오늘).{0,32}(?:또\s*)?(?:때리|때려|맞고|폭행|협박|위협|감금|가둬|죽이|성폭행|성폭력|성추행|강간|목을?\s*조르)/;
const HYPOTHETICAL_SAFETY_PATTERN =
  /(?:(?:죽이겠다고|죽인다고|때리겠다고|협박한다고|위협한다고|죽\s*고\s*싶다고|자살한다고|자해한다고).{0,16}(?:하면|한다면|말하면|경우)|(?:때릴|죽일|해칠)까\s*봐)/;
const BENIGN_DELIVERY_TRACKING_PATTERN =
  /(?:배송|택배)\s*기사.{0,40}(?:내\s*)?위치(?:를|을)?\s*추적.{0,40}(?:집|문)\s*앞.{0,24}기다리/;
const BENIGN_CAKE_KNIFE_PATTERN =
  /(?:(?:케이크|케익).{0,28}(?:칼|나이프)|(?:칼|나이프).{0,28}(?:케이크|케익)).{0,40}(?:사진|커팅|자르|촬영)|(?:케이크|케익|커팅)\s*(?:칼|나이프)/;
const BENIGN_IDIOM_PATTERN =
  /(?:드레스\s*투어|결혼\s*준비|예식\s*준비|친구가\s*웃겨|웃겨서|너무\s*(?:힘들|피곤|바빠)).{0,40}(?:죽을\s*것\s*같|죽겠)/;
/**
 * `<원인 서술어> 죽겠` 은 관용구다.
 *
 * `BENIGN_IDIOM_PATTERN` 은 **문장 어딘가에** 여섯 구절이 있는지 물어서, 그 구절이
 * 없는 관용구를 못 거른다. 실제로 `나 다리 아파 죽겠어`·`엄마가 무릎 아파 죽겠대`
 * 가 자해 위기로 확정됐다. 여기서는 **`죽겠` 바로 앞에 무엇이 오는가** 를 본다 —
 * 관용구는 원인 서술어가 붙고(`아파 죽겠`), 자해 진술은 안 붙는다(`나 죽겠어`).
 *
 * ## 목록이 좁은 것은 의도다
 *
 * 이 목록이 좁으면 오탐이 남는다(지금과 같다). 넓으면 **진짜 자해 진술을 놓친다.**
 * 두 대가가 같지 않으므로 좁은 쪽으로 틀렸다. `무서워` 를 넣지 않은 것도 같은
 * 이유다 — 무섭다는 말은 관용구이기도 하고 진짜 공포이기도 하다.
 *
 * ## 이것만으로는 부족해서 관문이 하나 더 있다
 *
 * `본식 준비가 힘들어 죽겠고 진짜로 죽어버리고 싶어요` 는 관용구 모양(`힘들어
 * 죽겠`)이면서 진짜 자해 진술이다. 그래서 같은 문장에
 * `SELF_HARM_ELSEWHERE_PATTERN` 이 있으면 이 무름을 **적용하지 않는다.**
 * 관용구 판정은 그 문장에 다른 자해 신호가 없을 때만 쓴다.
 */
const IDIOMATIC_INTENSIFIER_BEFORE_DEATH_PATTERN =
  /(?:아파|아프|배고파|배고프|더워|추워|피곤해|졸려|바빠|귀찮아|답답해|막막해|민망해|궁금해|복잡해|애매해|짜증나|정신없어|미안해|부러워|설레|웃겨|떨려|빠져|힘들어|힘드)\s*죽겠/;
/**
 * 같은 문장 안의 **다른** 자해 신호. 위 관용구 무름을 되무르는 자리다.
 *
 * `죽겠` 갈래를 무르더라도 이 신호가 있으면 그 문장은 여전히 자해 진술이다.
 * 목록은 관용 용법이 없는 표현만 담는다 — `죽고 싶`, `죽어 버리`, `유서`,
 * `손목을 긋` 은 강조로 쓰이지 않는다.
 *
 * 2026-09-03: 맨 `유서` 는 예외다. `유서 깊은 한옥` 은 "역사가 오래된" 이라는
 * 고정 관용구라, 여기 그대로 두면 `나 유서 깊은 한옥 보고 설레 죽겠어` 가
 * 관용구 무름을 되물어 자해 위기가 된다. 그래서 `깊` 이 뒤따르는 형태만 뺀다
 * (조사가 끼는 `유서가 깊은` 도 함께). `유서 남겼어` 는 그대로 잡힌다.
 */
const SELF_HARM_ELSEWHERE_PATTERN =
  /(?:죽\s*고\s*싶|죽어\s*버리|죽을\s*(?:래|거|생각|결심|방법)|죽어야\s*(?:겠|끝|하)|자살|자해|목숨을?\s*끊|유서(?![가는를을도]?\s*깊)|손목(?:을|를)?\s*(?:긋|그어|그었|그은)|목(?:을|를)?\s*(?:매|맬|맸)|(?:물|강물|바다|한강|저수지)(?:에|로)?\s*빠져\s*죽|번개탄|연탄|옥상|난간|뛰어내리|한강\s*다리|그만\s*살고\s*싶|사라지고\s*싶)/;
/**
 * 경험 자체를 부정하는 형태. `죽고 싶다는 생각은 해본 적 없어` 는 고백이 아니다.
 *
 * 기존 `negatedReporterSelfHarm` 은 1인칭 주어를 요구하는데, 이 형태는 주어를
 * 생략한다(`결혼 준비가 힘들긴 해도 죽고 싶다는 생각은 해본 적 없어`).
 */
const DENIED_IDEATION_EXPERIENCE_PATTERN =
  /(?:죽\s*고\s*싶|자살|자해|그만\s*살고\s*싶|사라지고\s*싶|나쁜\s*생각|극단적(?:인)?\s*(?:생각|마음|선택))[^.!?\n]{0,24}(?:해\s*본\s*적(?:이)?\s*없|한\s*적(?:이)?\s*없|전혀\s*(?:안|없)|조금도\s*없|은\s*아니)/;
/** 위 부정을 잴 때 "자해 진술이 있는 절" 로 셀 표현. */
const IDEATION_CUE_PATTERN =
  /(?:죽\s*고\s*싶|자살|자해|그만\s*살고\s*싶|사라지고\s*싶|나쁜\s*생각|극단적(?:인)?\s*(?:생각|마음|선택))/;
/**
 * 약이 **떨어졌다**는 뜻의 `다 먹었다`.
 *
 * 과다복용 패턴이 `약 + (다|전부|모두) + 먹` 을 받는데, 한국어에서 그 형태는
 * "남은 것을 다 먹었다(= 떨어졌다)" 로도 쓰인다. 실측에서 `진통제 다 먹었는데도
 * 드레스 투어는 다녀왔어` 가 자살 시도로 확정됐다.
 *
 * 양보 어미(`는데도`·`지만`)나 증상이 계속된다는 서술이 뒤따르면 소진이다 —
 * 과다복용을 말하는 사람은 그렇게 잇지 않는다. **수량이 있는 형태**
 * (`한 통`, `스무 알`)는 여기 걸리지 않으므로 그대로 시도로 남는다.
 */
const MEDICINE_EXHAUSTED_PATTERN =
  /(?:약|알약|진통제|감기약|영양제|비타민|타이레놀)(?:을|를)?\s*(?:다|전부|모두)\s*먹었(?:는데도|지만|는데\s*[^.!?\n]{0,20}(?:안|아직|계속|그대로|여전히))/;
const FICTION_NEWS_CONTEXT_PATTERN =
  /(?:(?:영화|소설|드라마|게임|뉴스|기사).{0,100}(?:장면|대사|사건|보도|읽었|분석|검토|주인공|등장인물)|(?:영화|소설|드라마)(?:에서|속에서).{0,80}(?:죽\s*고\s*싶|죽이겠|자살|자해|폭행|협박|위협))/;
const META_CONTEXT_PATTERN =
  /(?:(?:문구|표현|단어|대사|가사|예시|캠페인|예방\s*교육).{0,100}(?:검토|작성|추천|분석|가정(?:해|하면|한))|(?:검토|작성|추천|분석|가정(?:해|하면|한)).{0,100}(?:문구|표현|단어|대사|가사|예시|캠페인|예방\s*교육))/;
const FICTIONAL_GAME_CONTEXT_PATTERN = /게임(?:에서|중에|속에서)/;
const CURRENT_DISCLOSURE_OVERRIDE_PATTERN =
  /(?:(?:아니라|그런데|근데|하지만).{0,40}(?:나|저|남편|아내|배우자|남친|여친|신랑|신부|상대).{0,40}(?:진짜|지금|현재|오늘|방금).{0,40}(?:죽\s*고\s*싶|자살|자해|때리|맞고|협박|위협|칼|흉기)|(?:오늘|지금|현재|방금).{0,50}(?:때리|맞고|폭행|협박|위협|죽\s*고\s*싶|자살|자해|칼|흉기))/;
const CONCRETE_SELF_HARM_ATTEMPT_PATTERN =
  /(?:(?:졸피뎀|수면제|진통제|타이레놀|아세트아미노펜|약|알약)(?:을|를)?\s*(?:(?:[1-9]\d+)\s*(?:알|개)|한\s*(?:통|병)|여러\s*알|전부|모두|다|몽땅|너무\s*많이|많이|과다|과량|한꺼번에|왕창|잔뜩|한\s*(?:움큼|줌))(?:을|를)?\s*(?:먹|삼키|삼켰|복용|드시|드셨|드시고)|(?:옥상|난간|다리|베란다|한강).{0,36}(?:뛰어내리|몸을?\s*던지)(?:려고|려는|려|겠|ㄹ)|(?:뛰어내리|몸을?\s*던지)(?:려고|려는|려).{0,36}(?:옥상|난간|다리|베란다|한강)|(?:농약|락스|표백제|세제|부동액)(?:을|를)?\s*(?:마시|마셨|먹|삼키)|(?:번개탄|연탄)(?:을|를)?\s*(?:피우|피웠|피워|점화|켜)|(?:졸피뎀|수면제|진통제|타이레놀|아세트아미노펜|약|알약)(?:을|를)?\s*한\s*(?:통|병)(?:을|를)?\s*(?:다|전부|모두|몽땅)?\s*(?:먹었|삼켰|복용했|드시고|드셨)|(?:약|영양제|감기약|진통제)(?:이랑|랑|과|까지)[^.!?\n]{0,16}다\s*먹었[^.!?\n]{0,24}(?:어지러|토했|쓰러|의식|깨어나))/;
/**
 * **자해 수단을 준비했거나 방법을 찾고 있다.**
 *
 * 2026-09-03 실측: 이 부류가 안전망을 통째로 지나쳤다 — `목을 맬 끈을 찾고
 * 있었어요`·`매일 죽는 방법만 검색해요`·`진통제 스무 알을 세어 놨어`·
 * `수면제 한 통 사 왔는데`. 의도를 말하지 않고 준비만 말하는 형태라 기존
 * `죽고 싶` 계열 어디에도 안 걸린다.
 *
 * 낱말 하나로는 잡지 않는다 — `끈`·`알`·`통`·`칼` 은 결혼 준비에서 평범하게
 * 쓰인다. **수단 + 준비 동사**가 함께 있을 때만 센다.
 */
/**
 * 화자가 **스스로 농담이라고 밝힌** 문장. `더는 못 살겠다고 신랑한테 농담했어`.
 *
 * 이 목록은 좁게 둔다 — 진짜 위기를 농담으로 포장하는 경우가 있으므로, 같은
 * 문장에 다른 위기 신호가 있으면 아래에서 이 무름을 쓰지 않는다.
 */
/**
 * **몸에 남은 피해.** 폭력을 말하지 않아도 결과가 말한다.
 *
 * `갈비뼈에 금이 갔어`·`입술이 터졌어요`·`온몸에 멍이 들었어요`.
 * 결과만으로는 사고일 수도 있으므로 아래 `PHYSICAL_ASSAULT_PATTERN` 이
 * **가해 행위와 함께** 있을 때만 쓴다.
 */
const BODILY_INJURY_RESULT_PATTERN =
  /(?:갈비뼈|코뼈|손목|팔|다리|이빨)(?:에|이|가)?\s*(?:금\s*(?:이|에)?\s*(?:가|갔|간)|부러|골절)|멍이\s*들|입술이\s*터|이마가\s*찢|피가\s*나|응급실(?:에|을)?\s*(?:실려|다녀|갔)/;
/**
 * **사람을 때린 서술.**
 *
 * 기존 패턴은 배우자 호칭 + `때리` 처럼 넓게 잡거나, 반대로 `저를` 목적어를
 * 직접 요구해서 그 사이 형태를 전부 놓쳤다 — `주먹을 휘둘러 입술이 터졌어요`,
 * `머리를 벽에 박았어요`, `밀쳐서 계단에서 굴렀어요`, `머리채를 잡고 끌고`.
 *
 * 평범한 문장과 가르는 것은 **사람이 대상이라는 표시**다. 축가 연습하다 휘두른
 * 주먹은 마이크를 치고, 아이들이 민 것은 카트를 굴린다. 그래서 각 갈래가
 * 사람 목적어나 신체 부위, 또는 피해 결과를 함께 요구한다.
 */
const PHYSICAL_ASSAULT_PATTERN =
  /주먹(?:을|를)?\s*휘둘(?:러|렀|렀어|리)\s*.{0,16}(?:저|제|나|내|날|절|얼굴|입술|머리|배|몸|맞)|(?:저|제|나|내|날|절)(?:를|을|한테|에게)\s*.{0,16}주먹(?:을|를)?\s*휘둘|(?:저|제|나|내|날|절)(?:의|를|을)?\s*(?:머리|얼굴|배|몸|팔|다리|목)(?:를|을)?\s*.{0,10}(?:때렸|때리|치셨|쳤|박았|비틀|졸랐|잡고\s*끌)|머리채(?:를|을)?\s*(?:잡|잡고|잡아|끌)|(?:같이\s*죽자|죽자)고\s*.{0,10}목(?:을|를)?\s*잡|(?:남편|신랑|아내|신부|남친|여친|배우자|예비\s*신랑|예비\s*신부|시어머니|시아버지|시댁|장모|장인|형부|저(?:를|한테)|나(?:를|한테)|절|날)[^.!?\n]{0,20}밀쳐(?:서|져)?\s*.{0,14}(?:계단|바닥|넘어|굴렀|다쳤)|던진\s*.{0,10}(?:컵|그릇|물건|리모컨).{0,12}(?:맞|찢|터|다쳤)|맞아서\s*.{0,16}(?:응급실|갈비뼈|멍|피)/;
/**
 * **가둠·이동 통제.** `저를 못 나가게 현관문을 잠가버렸어요`.
 *
 * `못 나가게` 자체는 강아지 안전문·하객 동선에도 쓰인다. 그래서 **사람이
 * 대상**이거나 **화자가 당했다는 표시**를 함께 요구한다.
 *
 * 2026-09-03: 그 요구가 첫 갈래에만 있었다. 나머지 갈래는 아무 조건이 없어서
 * `강아지가 못 나가게 현관을 잠가뒀어요`·`하객 못 나가게 동선을 막아 놨어`·
 * `신랑이 폰을 뺏어 갔어` 가 전부 응급 위기가 됐고, 그 문장들은 저장되지 않고
 * 사라졌다. 그래서 갈래마다 조건을 되돌린다.
 *  - 잠금 갈래: 사람 표지를 `못 …게` 앞이나 잠금 동사 사이에 요구한다. 잠금
 *    동사에서 `막아` 는 뺀다 — `못 가게 막아` 는 한국어 일상 관용구라
 *    `신혼여행 못 가게 막아요`·`동선을 막아 놨어` 를 끌어왔고, 이 갈래에만
 *    기대는 진짜 감금 진술은 코퍼스에 없었다.
 *  - 소지품 갈래: 당한 쪽 표시인 피동 `뺏겼` 는 주어 없이도 인정하고,
 *    제3자 서술형 `뺏어 갔` 은 가해자 호칭과 화자 소유격을 함께 요구한다
 *    (`남편이 제 휴대폰을 뺏어 갔어요` 유지, `동생이 내 차 키를 뺏어 갔어` 제외).
 */
const CONFINEMENT_PATTERN =
  /(?:저|제|나|내|날|절)(?:를|을)?\s*(?:못\s*(?:나가게|나오게|도망가게)|가둬|가뒀|감금)|(?:(?:저|제|나|내|날|절|아내|남편|신랑|신부|배우자|남친|여친)[^.!?\n]{0,24}못\s*(?:나가게|나오게|도망가게|가게)|못\s*(?:나가게|나오게|도망가게|가게)[^.!?\n]{0,20}(?:저|제|나|내|날|절|아내|남편|신랑|신부|배우자|남친|여친))\s*.{0,20}(?:잠가|잠갔|잠그|묶)|못\s*(?:나가게|나오게|도망가게)\s*.{0,20}뺏겼|(?:남편|신랑|아내|신부|배우자|남친|여친|시어머니|시아버지|시댁|장모|장인)[^.!?\n]{0,16}(?:제|내|저의|나의)\s*(?:휴대폰|핸드폰|폰|신발|차\s*키)(?:이랑|과|을|를)?\s*.{0,10}뺏(?:겼|어\s*갔|아\s*갔)|(?:휴대폰|핸드폰|폰|신발|차\s*키)(?:이랑|과|을|를)?\s*.{0,10}뺏겼/;
/**
 * **성적 강요.** 기존 패턴은 `동의 없이` 라는 말을 요구해서, 실제로 쓰이는
 * `싫다는데도 계속 관계를 강요해서 무서워요` 를 전부 놓쳤다.
 *
 * `관계를 강요` 는 업체와의 독점 계약에도 쓰이므로 **사람 행위자**나 **거절
 * 표시**를 함께 요구하고, 부정문(`강요하시진 않았어`)은 제외한다.
 */
const SEXUAL_COERCION_PATTERN =
  /(?:싫다(?:는데도|고\s*(?:해도|했는데도|하는데도))|거절(?:했는데도|하는데도|하면)|원치\s*않는데)[^.!?\n]{0,28}(?:관계|잠자리|스킨십|몸)(?:를|을)?\s*(?:강요|요구|만지)|(?:남편|신랑|예비\s*신랑|남친|남자친구|배우자|여친)(?:이|가)[^.!?\n]{0,28}(?:관계|잠자리)(?:를|을)?\s*강요(?!하지\s*않|하시진\s*않|한\s*적\s*없)|억지로\s*몸(?:을|를)?\s*만지/;
/**
 * **신변을 정리하고 자기를 지운다.**
 *
 * `통장 넘겼어`·`정리 다 됐어` 만으로는 절대 세지 않는다 — 축의금 장부 정리와
 * 구별되지 않는다(반례 코퍼스에 그대로 있다). 갈리는 것은 **자기가 이제 필요
 * 없다는 말**이다: `나는 이제 필요 없어`, `내 몫은 필요 없어`, `내가 없어도`.
 *
 * 보험 수령인 변경은 그 자체로 드물고 결혼 준비 대화에서 다른 뜻이 없다.
 */
const AFFAIRS_IN_ORDER_PATTERN =
  /(?:넘겼|넘기고|돌려놨|정리|바꿔놨|맡겼)[^.!?\n]{0,30}(?:나는|저는|내|제)\s*(?:이제\s*)?(?:필요\s*없|몫은\s*필요\s*없)|내가\s*없어도[^.!?\n]{0,24}(?:진행|해\s*줘|하라고|하래)|보험금\s*수령인(?:을|를)?\s*[^.!?\n]{0,16}(?:바꿔|변경|바꾸)/;
const SELF_DECLARED_JOKE_PATTERN =
  /농담(?:이|으로|삼아|했|이라고|이야|입니다)|장난(?:으로|이야|삼아|이라고)|우스개|웃자고/;
const SELF_HARM_MEANS_PATTERN =
  /(?:목(?:을|를)?\s*(?:맬|매려|매기)\s*(?:끈|줄|밧줄|생각|결심)|(?:끈|밧줄)(?:을|를)?\s*.{0,8}목(?:을|를)?\s*(?:매|맬))|죽는\s*(?:방법|법)(?:만|을|를|이나)?\s*(?:검색|찾|알아보|뒤져)|(?:자살|자해)\s*(?:방법|사이트|카페)|(?:난간|베란다|옥상|창문)(?:을|를)?\s*넘(?:으려|어가려|을|어서려)|(?:수면제|졸피뎀|신경안정제|항우울제)\s*한\s*(?:통|병)(?:을|를)?\s*(?:사|샀|사\s*왔|구했|모았)|(?:[1-9]\d*|열|열다섯|스무|스물|서른|마흔)\s*알(?:을|를)?\s*(?:세어|세고|셌|모아|모았|따로\s*빼|손에\s*쥐)|(?:칼|흉기)(?:을|를)?\s*들고\s*.{0,14}(?:앉아\s*있|앉아서|한참)|(?:수면제|졸피뎀|진통제|약)\s*한\s*(?:통|병)\s*.{0,10}(?:놓고|앞에\s*두고)/;
/**
 * **이미 자해한 흔적.** 과거형이지만 지금 안전하다는 뜻이 아니다.
 *
 * `손목 그은 자국이 남았어요`·`손목 자국 볼까 봐 긴팔만 입고 다녀` 가 그냥
 * 지나갔다. `손목` 만으로는 안 센다(시계·팔찌) — **긋는 행위나 자국**이 붙어야 한다.
 */
const SELF_HARM_SCAR_PATTERN =
  /손목(?:을|를|에|의)?\s*.{0,10}(?:그은|그었|그어|긋|자해)|손목\s*자국.{0,20}(?:볼까\s*봐|보일까|들킬까|가리|가려|숨기|긴팔|소매)|(?:그은|그었)\s*자국/;
/**
 * **위험한 장소에 지금 가 있다.** 가장 급한 형태인데 하나도 안 걸렸다.
 *
 * `아파트 옥상에 올라와 있어`·`한강 다리 난간 앞에 한참 서 있었어`.
 * 장소 낱말만으로는 절대 안 센다 — 옥상 정원 예식장, 한강 뷰 신혼집이 평범한
 * 결혼 준비 대화다. **거기 있다는 서술**(올라와/서 있/앉아 있)이 붙어야 한다.
 */
const SELF_HARM_LOCATION_PRESENCE_PATTERN =
  /(?:옥상|한강\s*다리|고가|육교)(?:에|앞에|위에|끝에)?\s*.{0,12}(?:올라와\s*있|올라가\s*있|올라가\s*계|올라왔|서\s*있었|서\s*있어|앉아\s*있|있다(?:고|는)|걸어가는\s*중)|난간(?:에|위에)\s*.{0,10}(?:걸터앉|손\s*올려|올라)/;
/**
 * **죽음을 직접 말하지 않는 자해 의사.**
 *
 * `죽어야 끝나겠다`·`죽는 것 말고 답이 없어요`·`영영 가고 싶어`·
 * `이 세상에서 그만 내려가고 싶어`·`눈 안 떠졌으면`.
 *
 * `끝내고 싶어`·`그만하고 싶어`처럼 **결혼 준비 대화에서 평범하게 쓰이는 말은
 * 여기 넣지 않았다.** "예단 얘기 이제 그만하고 싶어"가 위기가 되면 안 된다.
 * 그 부류는 아래 `TERMINAL_DESPAIR_PATTERN` 이 **두 신호가 함께 있을 때만** 센다.
 */
/**
 * `없어지고 싶다`·`사라지고 싶다` 는 **창피함**을 뜻하기도 한다.
 *
 * 반례 코퍼스에 그 용법이 그대로 있다 — `상견례 때 너무 민망해서 그냥 없어지고
 * 싶었어`, `청첩장 오타 난 거 보고 창피해서 사라지고 싶었어`.
 * 그래서 **부끄러움 표시가 같은 문장에 있으면 세지 않는다.**
 */
const EMBARRASSMENT_CONTEXT_PATTERN =
  /민망|창피|부끄|쪽팔|오타|사진에서|못\s*나왔/;
const VANISHING_WISH_PATTERN =
  /(?:없어지고|사라지고|지워지고)\s*싶|(?:내가|제가)?\s*(?:먼저\s*)?없어질\s*것\s*같/;
const EUPHEMISTIC_SELF_HARM_IDEATION_PATTERN =
  /죽어야\s*.{0,8}(?:끝나|끝날|끝난다)|죽을\s*결심|죽는\s*(?:것|거)\s*말고\s*.{0,8}(?:답|방법|수)(?:이|가)?\s*없|(?:영영|아주)\s*(?:가고|떠나고|사라지고|없어지고)\s*싶|(?:이|이제)?\s*세상(?:에서|을)?\s*(?:그만\s*)?(?:내려가고|떠나고|없어지고)\s*싶|(?:내일|아침에|다시(?:는)?|영영|그냥)[^.!?\n]{0,12}눈(?:을|이)?\s*(?:안|못)\s*(?:떠졌으면|뜨면\s*좋겠|떴으면)|아무도\s*없는\s*곳으로\s*(?:영영|그냥)?\s*가고\s*싶|(?:보험금|사망\s*보험)(?:이)?\s*(?:낫|나을)|마지막\s*편지(?:를|을)?\s*(?:써\s*놨|써\s*뒀|남겨|남기|두고|써서\s*.{0,10}(?:서랍|넣어)|다\s*썼)|유서(?![가는를을도]?\s*깊)/;
/**
 * **끝내겠다는 말은 두 신호가 함께 있을 때만 센다.**
 *
 * `끝내고 싶어`·`못 버티겠어`·`못 살겠어`는 결혼 준비 대화에서 그 자체로는
 * 평범한 좌절이다("이 준비 다 끝내고 싶다"). 그래서 **절망 표지**(더는·더 이상·
 * 오늘 밤·그냥 여기서·진짜로)와 **끝냄 표현**이 같은 문장에 있을 때만 센다.
 *
 * 이 조건을 걸지 않고 낱말만 넣었더니 평범한 문장이 무더기로 걸렸다 —
 * 그래서 조건을 남긴다.
 *
 * 2026-09-03: 그런데 주석과 코드가 어긋나 있었다. `못 하겠` 은 과제 포기이지
 * 자해 진술이 아닌데 절망 표지 하나로 확정됐고(`결혼 준비 더는 못 하겠어`),
 * `진짜|정말` 은 절망 표지가 아니라 흔한 강조어인데 `끝내고 싶` 과 묶여
 * `이 준비 다 끝내고 싶다 진짜` 를 위기로 만들었다. 저장소 코퍼스에서 이 셋이
 * 지키는 진짜 위기는 0건이었으므로 되돌린다.
 * `이제 그만` 만은 남기되, 앞뒤 16자에 결혼 작업 명사가 있으면 세지 않는다 —
 * `청첩장 작업 이제 그만 끝내고 싶어` 는 좌절이고, 명사가 없는
 * `이제 그만 끝내려고` 는 그대로 위기로 남는다.
 * (`더는 못 살겠`·`더 이상 못 버티겠` 은 진짜 양성이 걸려 있어 손대지 않는다.)
 */
const TERMINAL_DESPAIR_PATTERN =
  /(?:더는|더\s*이상)\s*못\s*(?:살겠|버티|버틸)|(?:오늘\s*밤|그냥\s*여기서|여기서\s*그냥)\s*.{0,10}끝내(?:려|고\s*싶|자|겠)|(?<!(?:청첩장|예단|혼수|스드메|투어|플래너|촬영|스냅|하객|예식|웨딩|계약|예약|답사|준비|작업)[^.!?\n]{0,16})이제\s*그만\s*.{0,10}끝내(?:려|고\s*싶|자|겠)(?![^.!?\n]{0,16}(?:청첩장|예단|혼수|스드메|투어|플래너|촬영|스냅|하객|예식|웨딩|계약|예약|답사|준비|작업))|못\s*(?:살|버틸)\s*것\s*같(?:아|은데|아요).{0,20}(?:그만|끝|사라|없어)/;
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
  /(?:죽\s*고\s*싶|자살|자해|목숨을?\s*끊|칼|흉기|때리|때려|때렸|때린|맞고|맞았|폭행|협박|위협|감금|가둬|성폭행|성폭력|성추행|강간|목을?\s*조르|수면제|졸피뎀|농약|락스|표백제|번개탄|연탄)/;
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

/**
 * 자해 진술이 **모두** 부정된 문장인가.
 *
 * 문장 전체에 부정이 하나라도 있으면 무르는 방식은 위험하다 — `죽고 싶다는 생각은
 * 해본 적 없어. 근데 어제 자해했어` 가 통째로 지워진다. 그래서 **자해 표현이 든
 * 절을 모두 세고, 그 절이 전부 부정형일 때만** 무른다.
 */
function everyIdeationClauseIsDenied(text: string): boolean {
  const withIdeation = splitAmoraSafetyClauses(text).filter((clause) =>
    IDEATION_CUE_PATTERN.test(clause),
  );
  if (withIdeation.length === 0) return false;
  if (!withIdeation.every((clause) => DENIED_IDEATION_EXPERIENCE_PATTERN.test(clause))) {
    return false;
  }
  // 부정되지 않은 **다른 절**에 자해 신호가 남아 있으면 무르지 않는다.
  // `자해한 적 없어요 그런데 오늘 손목을 그었어요` 가 통째로 지워지던 자리다.
  return splitAmoraSafetyClauses(text)
    .filter((clause) => !IDEATION_CUE_PATTERN.test(clause))
    .every(
      (clause) =>
        !SELF_HARM_ELSEWHERE_PATTERN.test(clause)
        && !CONCRETE_SELF_HARM_ATTEMPT_PATTERN.test(clause),
    );
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

/**
 * 2026-09-19 이전의 `assessAmoraSafetyText` 본문 그대로다(origin/main db249054).
 * 이름만 바뀌었고, 절마다 자기를 다시 부르는 자리도 이 함수를 부른다 — 그래서 이
 * 함수의 판정은 한 글자도 달라지지 않는다. 새 규칙은 아래 `assessAmoraSafetyText`
 * 가 **이 함수가 아무것도 못 찾았을 때만** 덧붙인다.
 */
function assessAmoraSafetyTextBase(value: string): AmoraSafetyAssessment {
  const text = normalizeAmoraSafetyText(value);
  const clauses = splitAmoraSafetyClauses(text);
  const hasIndependentCurrentDisclosure =
    hasIndependentCurrentDisclosureClause(text);
  // 약이 떨어졌다는 뜻의 `다 먹었다`. **최상위에서만** 판정한다 —
  // 이 함수는 아래에서 절마다 자기를 다시 부르는데, 절 분리기가 `먹었` 과
  // `는데도` 사이를 자르므로(`(?<=[았었였했겠])는데` 가 경계) 절 안에서는 양보
  // 어미가 이미 사라지고 없다. 그래서 절 단위로 물으면 영원히 걸리지 않는다.
  if (
    MEDICINE_EXHAUSTED_PATTERN.test(text)
    && !SELF_HARM_ELSEWHERE_PATTERN.test(text)
    && !VIOLENCE_CUE_PATTERN.test(text)
    // `감기약 다 먹었는데도 안 나아 그리고 수면제 한 통 먹었어` 를 지우면 안 된다.
    // 소진 문구 하나 때문에 같은 메시지의 진짜 시도까지 무르는 자리다.
    && !hasIndependentImmediateSafetyClause(text)
  ) {
    return {
      resolution: "no_safety_signal",
      kind: null,
      responseDirection: null,
      events: [],
    };
  }
  // 자해 표현이 든 절이 **전부** 부정형이면 고백이 아니다.
  //
  // 이 무름은 아래 관용구 관문 **밖에** 있어야 한다. 그 관문은
  // `!hasIndependentImmediateSafetyClause(text)` 를 요구하는데 `죽 고 싶` 자체가
  // 그 독립 단서라, 안에 두면 이 형태는 절대 무를 수 없다.
  //
  // 폭력·시도 단서가 있으면 무르지 않는다 — 자해를 부정하면서 폭력을 말하는
  // 문장까지 지워지면 안 된다.
  if (
    everyIdeationClauseIsDenied(text)
    && !VIOLENCE_CUE_PATTERN.test(text)
    && !CONCRETE_SELF_HARM_ATTEMPT_PATTERN.test(text)
  ) {
    return {
      resolution: "no_safety_signal",
      kind: null,
      responseDirection: null,
      events: [],
    };
  }
  if (
    (
      BENIGN_DELIVERY_TRACKING_PATTERN.test(text)
      || BENIGN_CAKE_KNIFE_PATTERN.test(text)
      || BENIGN_IDIOM_PATTERN.test(text)
      // `<원인 서술어> 죽겠` 은 관용구다. 단 같은 문장에 다른 자해 신호가 있으면
      // 관용구 판정을 쓰지 않는다 — `힘들어 죽겠고 진짜로 죽어버리고 싶어요` 는
      // 관용구 모양이면서 진짜 고백이다.
      || (
        IDIOMATIC_INTENSIFIER_BEFORE_DEATH_PATTERN.test(text)
        && !SELF_HARM_ELSEWHERE_PATTERN.test(text)
      )
    )
    // 폭력·흉기 같은 독립 단서가 있으면 무르지 않는다. `남편이 때려서 아파
    // 죽겠어` 가 관용구로 지워지면 안 된다.
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
      clauses.map((clause) => assessAmoraSafetyTextBase(clause)),
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
    `${KNOWN_OTHER_PATTERN.source}(?:가|이|는|은|도)?\\s*.{0,48}(?:죽\\s*고\\s*싶다고|죽겠다고|죽겠대|자살(?:하겠다고|하려고)|자해(?:하겠다고|하려고)|그만\\s*살고\\s*싶다고|사라지고\\s*싶다고|없어지고\\s*싶다고|없어지고\\s*싶다|죽을\\s*거라고)`,
  );
  // 동사를 세기로 가른다.
  //
  // 강한 쪽(`자살`·`자해`·`목숨을 끊`·`죽고 싶`·`사라지고 싶`)은 한국어에 관용
  // 용법이 없어서 주어를 느슨하게 잡아도 평범한 문장을 끌어오지 않는다.
  // 약한 쪽(`죽겠`·`죽을 래/거`)은 강조 표현으로 훨씬 자주 쓰이므로 **경계를
  // 요구하는 주어**만 인정한다.
  //
  // 이 구분이 없으면 둘 중 하나를 반드시 잃는다. 경계를 통째로 씌웠더니
  // "나한테도 자해 충동이 와요"(조사 겹침)·"저희도 목숨을 끊는 얘기를 했어요"를
  // 놓쳤고, 경계를 아예 안 씌웠더니 "설레 죽겠어"가 자해 위기가 됐다.
  const reporterSelfHarm = new RegExp(
    `(?:${REPORTER_ACTOR_PATTERN.source}\\s*.{0,32}(?:죽\\s*고\\s*싶|자살|자해|목숨을?\\s*끊|그만\\s*살고\\s*싶|사라지고\\s*싶)|${BOUNDED_REPORTER_ACTOR_PATTERN.source}\\s*.{0,32}(?:죽겠|죽을\\s*(?:래|거))|${UNAMBIGUOUS_SELF_HARM_IDEATION_PATTERN.source}`
    // 아래 다섯은 **1인칭 주어를 요구하지 않는다.** 한국어는 주어를 생략하고,
    // 실측한 미탐 50건이 대부분 주어 없이 쓰였다(`매일 죽는 방법만 검색해요`).
    // 대신 각 패턴이 스스로 좁다 — 수단·흔적·장소·완곡 표현이 결혼 준비 어휘와
    // 겹치지 않도록 동사나 상태 서술을 함께 요구한다.
    + `|${SELF_HARM_MEANS_PATTERN.source}`
    + `|${SELF_HARM_SCAR_PATTERN.source}`
    + `|${SELF_HARM_LOCATION_PRESENCE_PATTERN.source}`
    + `|${EUPHEMISTIC_SELF_HARM_IDEATION_PATTERN.source}`
    + `|${TERMINAL_DESPAIR_PATTERN.source}`
    + `|${AFFAIRS_IN_ORDER_PATTERN.source})`,
  );
  // '식전'의 '전'과 제외할 자해 소재를 1인칭 고백으로 합치지 않는다.
  // 실제 고백의 나머지 구절과 다른 위기 판정에는 원문을 그대로 남긴다.
  const reporterSelfHarmEvidence = withoutAmoraExcludedWeddingVideoScenes(text);
  // `없어지고 싶다` 는 창피함을 뜻하기도 한다. 부끄러움 표시가 없을 때만 센다.
  const vanishingWish =
    VANISHING_WISH_PATTERN.test(text)
    && !EMBARRASSMENT_CONTEXT_PATTERN.test(text)
    // `차라리 사라지고 싶은 건 아니야` 는 부정이다. 기존 테스트가 잡았다.
    && !/(?:없어지고|사라지고|지워지고)\s*싶(?:은|다는)?\s*(?:건|것은|게)\s*아니/.test(text)
    && !/(?:없어지고|사라지고|지워지고)\s*싶지\s*(?:는\s*)?않/.test(text);
  // 화자가 스스로 농담이라고 밝혔고 **다른 위기 신호가 없으면** 무른다.
  // 진짜 위기를 농담으로 포장하는 경우가 있으므로 조건을 건다.
  const declaredJokeOnly =
    SELF_DECLARED_JOKE_PATTERN.test(text)
    && !SELF_HARM_ELSEWHERE_PATTERN.test(text)
    && !SELF_HARM_MEANS_PATTERN.test(text)
    && !CONCRETE_SELF_HARM_ATTEMPT_PATTERN.test(text)
    && !VIOLENCE_CUE_PATTERN.test(text);
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
  // 신체 위험을 뜻하지 않는 "협박"의 목적어. 결혼 준비에서 일상적으로 쓰인다 —
  // "이혼한다고 협박", "파혼한다고 협박", "위약금으로 협박". 이런 문장에 112·119
  // 응급 안내를 내보내면 사실이 아닐 뿐 아니라, 이 경로는 원문을 저장도 전송도
  // 하지 않으므로 **사용자가 쓴 글이 사라진다**.
  const nonPhysicalThreatObject =
    /(?:이혼|파혼|헤어지|결혼\s*(?:안|못)|취소|파기|소송|고소|신고|위약금|환불|계약|해지|잠수|연락\s*(?:안|끊)|다이어트|담배|술)/;
  // 화자를 목적어로 잡되 **조사를 요구한다.** 조사 없이 두면 `날짜`의 `날`,
  // `저녁`의 `저` 같은 부분일치가 걸린다 — 실제로 "날짜 안 바꾸면 결혼 못 시킨다고
  // 협박하세요" 가 그렇게 즉시위기로 확정됐다.
  const reporterObjectBound = /(?:(?:나|저)(?:를|한테|에게|더러|보고)|날(?=\s)|절(?=\s))/;
  // 협박·위협은 그 자체로 신체 위험이 아니다. 같은 정규식의 다른 갈래
  // (`칼|흉기`, `차로 … 들이받`)는 이미 문맥이나 목적어를 요구하는데 이 갈래만
  // 아무것도 요구하지 않아서, 파트너 호칭이 어디든 들어 있으면 확정됐다.
  // 그래서 **화자가 대상일 때만** 여기서 잡는다. 흉기·살해 협박은 위 갈래와
  // `currentReporterTargetDanger` 가 이미 덮는다.
  const threatAtReporter = new RegExp(
    `${PARTNER_PATTERN.source}(?:가|이|는|은)?\\s*.{0,32}${reporterObjectBound.source}\\s*.{0,16}(?:협박|위협)`,
  );
  const otherInterpersonalDanger = new RegExp(
    `${PARTNER_PATTERN.source}(?:가|이|는|은)?\\s*.{0,48}(?:(?:칼|흉기).{0,24}(?:협박|위협|들고)|(?:때리|폭행|감금|가둬|가뒀|가둔|가두|폭력(?:을|를)?\\s*(?:쓰|썼|행사|휘두))|(?:휴대폰|전화기).{0,20}뺏.{0,24}(?:집|방|차).{0,12}(?:가둬|가뒀|가둔)|(?:집|문)\\s*앞.{0,28}기다리.{0,28}(?:계속\\s*)?(?:따라오|따라와|쫓아오)|차로.{0,20}${REPORTER_TARGET_PATTERN.source}\\s*.{0,12}들이받(?:으려|으려고|을\\s*거))`,
  );
  // 가해자 호칭을 앞에 두지 않는 서술. 각 패턴이 스스로 사람 목적어나 피해를
  // 요구하므로, 호칭이 없어도 평범한 문장을 끌어오지 않는다.
  const standaloneInterpersonalDanger =
    PHYSICAL_ASSAULT_PATTERN.test(text)
    || CONFINEMENT_PATTERN.test(text)
    || SEXUAL_COERCION_PATTERN.test(text)
    // 폭력 동사와 몸에 남은 피해가 함께 있으면 사고가 아니다.
    || (VIOLENCE_CUE_PATTERN.test(text) && BODILY_INJURY_RESULT_PATTERN.test(text))
    // 화자를 죽이겠다는 말은 호칭이 없어도 위기다.
    || /(?:저|나|날|절)(?:를|을)?\s*.{0,12}죽(?:여\s*버리|이)겠다고/.test(text);
  // 화자를 향한 협박이라도 목적어가 이혼·위약금 같은 비신체 사안이면 응급이 아니다.
  const reporterThreatIsPhysical =
    threatAtReporter.test(text) && !nonPhysicalThreatObject.test(text);
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
        && !ATTEMPT_HYPOTHETICAL_PATTERN.test(clause)
        // 가정형은 절이 갈리면 무름이 닿지 않는다(`먹으면` 과 뒤 절이 분리).
        // 원문에도 물어야 `한꺼번에 다 먹으면 큰일 나겠지` 가 시도로 안 센다.
        && !ATTEMPT_HYPOTHETICAL_PATTERN.test(text),
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
    ((otherInterpersonalDanger.test(text) || standaloneInterpersonalDanger) || currentReporterTargetDanger.test(text))
    && reporterSelfHarm.test(reporterSelfHarmEvidence)
    && !declaredJokeOnly
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
    && reporterSelfHarm.test(reporterSelfHarmEvidence)
    && !declaredJokeOnly
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

  // 주어 없는 신호(수단·흔적·장소)는 **누가** 위험한지를 말하지 않는다.
  // 앞에 제3자 호칭이 있고 1인칭 표지가 없으면 그 사람 이야기다 —
  // `친구가 손목을 그었어요` 가 화자의 자해로 판정되면 안 된다.
  const knownOtherSubjectlessSelfHarm =
    new RegExp(
      `${KNOWN_OTHER_PATTERN.source}(?:가|이|는|은|도)?\\s*[^.!?\\n]{0,40}(?:${SELF_HARM_SCAR_PATTERN.source}|${SELF_HARM_MEANS_PATTERN.source}|${SELF_HARM_LOCATION_PRESENCE_PATTERN.source})`,
    ).test(text)
    && !EXPLICIT_REPORTER_ACTOR_PATTERN.test(text);
  if (
    (knownOtherSelfHarm.test(text) || knownOtherSubjectlessSelfHarm)
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
    (otherInterpersonalDanger.test(text) || standaloneInterpersonalDanger)
    || reporterThreatIsPhysical
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

  if ((reporterSelfHarm.test(reporterSelfHarmEvidence) || vanishingWish) && !declaredJokeOnly) {
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

/* ────────────────────────────────────────────────────────────────────────────
 * 계획형 1인칭 진술 규칙 (2026-09-19)
 *
 * `오늘 죽으려고`·`다음 할 일은 자살이야`·`내일 죽을 예정이에요` 처럼 **죽을 작정·계획을
 * 과업처럼 말하는** 문장을 위 본문은 못 잡는다(처음 보는 문장 126개 중 22개).
 *
 * ## 왜 넓은 정규식 갈래가 아닌가
 *
 * 세 번 넓혀 봤다. 넓힐 때마다 관용구·사람 아닌 주어·매체 무름을 같이 붙여야 했고,
 * 검토자는 매번 **양쪽으로** 서른 개씩 구멍을 찾았다(`내일 출근이라 죽을 예정 ㅠㅠ`·
 * `먹고 죽으려고`·`폰 죽으려고`·`같이 늙어 죽기로 했어` 가 위기가 됐고, 새 이른 반환은
 * origin/main 이 잡던 고백 55개를 지웠다). 이 경로의 오탐은 안부 한 번이 아니다 —
 * 채팅 라우트가 모델 답 대신 고정 위기 안내를 내보내서 **사용자의 질문이 답을 못 받는다.**
 *
 * ## 그래서 세 가지를 구조로 못 박는다
 *
 *  1. **덧붙이기만 한다.** 위 본문(`assessAmoraSafetyTextBase`)을 먼저 돌리고, 그것이
 *     아무것도 못 찾았을 때(`inconclusive`)만 이 규칙을 본다. 본문이 내린 판정 —
 *     위기든, 비즉시 안전이든, 부정·관용구·허구라서 무른 `no_safety_signal` 이든 —
 *     은 어떤 필드도 바뀌지 않는다. 잃는 포착·바뀌는 갈래는 구조상 0 이다.
 *  2. **메시지 전체가 닫힌 어휘여야 한다.** 장식을 걷고 공백·문장부호로 끊은 **모든** 토큰이
 *     아래 목록의 단위여야 하고, 그중 하나는 의도 핵이어야 한다. 장식은 우는 자모·우는 얼굴
 *     `;-;` 과 **짧은 허용 목록**의 이모지(우는·슬픈 얼굴, 부서진 하트)뿐이다. 그 밖의 그림 문자
 *     (이모지·딩뱃·국기·키캡·둘러싼 글자)와 구분자만으로 된 얼굴(`-.-`·`.-.`)은 토큰으로
 *     남는다 — 이모지·얼굴은 주어·이유·농담·물음을 실을 수 있어서(휴대폰·맥주·해골·물음 이모지)
 *     걷어내면 이 약속이 깨진다.
 *     이름·물건·기기·게임·목록에 없는 이유·다른 문자·붙여 쓴 말이 하나라도 있으면 이 규칙은
 *     서지 않고 origin/main 의 판정이 그대로 남는다. 그래서 관용구·사람 아닌 주어·매체
 *     무름이 **필요 없다** — 그런 문장은 어휘 밖 낱말을 반드시 하나는 품는다.
 *  3. **웃음 표시(웃음 자모·lol·`^^`·웃는 얼굴)나 물음표(물음 이모지 포함)가 있으면 서지 않는다.**
 *     이 규칙은 **정규화본만** 본다. `classifyAmoraCrisis`·범위 분류는 정규화한 글을 넘기고
 *     다른 입구는 원문을 넘기므로, 원문에서만 보이는 것으로 판정하면 두 입구가 갈린다.
 *
 * 여러 낱말짜리 서술어(`의미 없어`·`못 버티겠어`·`잘 있어`)는 **구 단위**로만 받는다.
 * 토큰 단위로 풀면 뜻을 뒤집는 조각(`없어`·`못`·`싫어`)이 어휘가 되어 떠돈다. 의도 핵도
 * 서술이 끝난 꼴만 받는다 — `자살 계획`·`죽을 생각` 뒤에 서술격이 없으면 핵이 아니라서
 * `자살 계획 없어`·`죽을 생각 없어` 는 서지 않는다.
 *
 * ## 알고 남긴 것
 *
 * 이 규칙은 **메시지 하나**를 본다. 앞 메시지에 주어·이유를 두고 조각만 보낸 말은 어휘만으로
 * 된 메시지라 선다: `죽으려고 진짜`(꾸짖음의 뒷절)·`오늘 죽을 준비 됐어`(운동)·`그냥 죽기로
 * 했어`(게임)·`우리 다 죽기로 했어`(게임)·`이따 죽을게`. 같은 메시지 안에 그 주어·이유가
 * 있으면 서지 않는다. 조각 가운데 흔한 셋은 구조로 막았다(아래 "좁힌 곳").
 *
 * ## 목록을 넓히는 규칙
 *
 * 이미 있는 낱말의 활용형·철자 변이만 더한다. 새 낱말은 넣지 않는다 — 괴로움 서술어와
 * 작별 꼬리만 예외이고, 그것도 평범한 상황을 말할 수 없는 낱말일 때만이다. **애매하면
 * 뺀다.** 빠진 낱말의 대가는 "그 문장이 오늘의 운영 판정을 그대로 받는다" 뿐이다.
 *
 * 설계 목록보다 **좁힌 곳**이 있다(전부 정밀도 쪽이다):
 *  - 떠도는 `것`·`거`·`걸` 은 뺐다. 핵 안(`죽는 거야`·`죽을 거야`)에서만 받는다.
 *  - `죽을 거야/래/게` 는 과장으로 흔히 쓰여서(`진짜 죽을래`), **시간어가 같이 있을 때만**
 *    선다. 1인칭 주어가 붙은 꼴(`나 죽을 거야`)은 위 본문이 이미 잡는다.
 *  - 따옴표·괄호·`=`·화살표는 구분자가 아니다. 인용(`'죽으려고' 라는 말`)은 언급이지
 *    진술이 아니다.
 *  - `곧` 은 어휘가 아니다. `곧 죽으려고`·`곧 죽을 거야` 는 앞 메시지의 폰·화분·편찮은
 *    어른을 두고도 똑같이 쓰는 임박상이다. 같은 까닭으로 `다`·`벌써`·`이미`·`모든 게` 가
 *    `죽으려-` 핵 앞에 오면(사이에 강조어 하나까지: `다 죽으려고 함`·`이미 죽으려고 함`·
 *    `벌써 진짜 죽으려고 함`) 1인칭 토큰이나 굳은 다짐(`결심했어`·`마음먹었어`·`정했어`)이
 *    같은 메시지에 있을 때만 선다.
 *  - 괴로움 서술어가 `죽으려-`·약한 핵(`죽을 거야/래/게`) **바로 앞**에 오면 `-서` 꼴
 *    (`힘들어서 죽으려고`)만 받는다. `힘들어 죽으려고`·`무서워 죽으려고 함`·`힘들다
 *    죽으려고` 는 `-어 죽겠다` 과장 관용구의 모양이고, 대개 남 얘기의 뒷절이다. 그 관용구가
 *    없는 `죽기로 했어` 앞에서는 맨 꼴도 이유로 받는다. `죽을 예정` 앞의 맨 `-어` 꼴
 *    (`힘들어 죽을 예정`)은 관용구의 계획 꼴이라 받지 않는다(3차 재검사).
 *  - `죽을` 은 `죽`(음식) + `을` 이기도 하다. `죽을 준비했어`·`죽을 계획했어` 는 죽 쑤는
 *    얘기로 읽혀서 핵이 아니다. `죽을 준비 됐어` 는 음식으로 읽으면 비문이라 남겼다.
 *  - 애교 어미 `-용`·`-공`(`죽으려구용`·`죽으려공`)은 받지 않는다. 웃음 표시와 같은 말투다.
 *  - `전에`·`후에`·`뒤에` 는 `식`·`결혼식`·`예식` 바로 뒤에서만 때다. 맨 `전에` 는 "예전에" 다.
 *
 * 설계 목록에 **더한 것**은 전부 이미 있는 낱말의 꼴이다: 조사(`오늘은`·`예식만`·`식이`),
 * 조사 없는 꼴(`밤`·`새벽`·`주말`·`연말`), 높임·평서 어미(`-습니다`·`-어요`·`힘들다`),
 * 채팅 어미(`죽으려고여`), `내` 의 높임 `제`, `마지막으로`, 계획 칸의 `자살임`·`…뿐`,
 * `마음 정했어`, `-기로` 꼬리(`결정했`·`목숨을 끊기로`·`생을 마감하기로`), `거다`·`꺼야`,
 * 날을 정하는 핵(`죽을 날짜 정했어`·`죽는 날 잡았어`). 작별 꼬리에는 `미안`·`고마웠어` 의
 * 높임 짝인 `죄송해요/죄송합니다`·`감사했어요/감사했습니다` 를 넣었다.
 * ──────────────────────────────────────────────────────────────────────────── */
const ps = String.raw;
const psAny = (...alternatives: readonly string[]) =>
  `(?:${alternatives.join("|")})`;

/**
 * 정중·채팅 어미. `죽으려고요`·`죽으려고여`. 애교 어미 `-용`·`-공`(`죽으려구용`·`죽으려공`)은
 * 받지 않는다 — 웃음 자모·`^^` 와 같은 장난 말투라서 웃음 관문이 막는 것을 어미가 다시 열게 된다.
 */
const PS_POLITE = ps`(?:요|여)?`;
/** `-려고` 뒤에 올 수 있는 `하다` 꼴. 전부 서술이고 뜻을 뒤집지 않는다. */
const PS_HADA_FORMS = ps`(?:해요?|합니다|한다|함|했(?:어요?|습니다)|하고 있(?:어요?|습니다))`;
const PS_AFTER_INTENT = ps`(?: (?:${PS_HADA_FORMS}|생각 ?중(?:이야|이에요|입니다)))?`;
const PS_INTENT_ENDING = ps`(?:고|구)${PS_POLITE}`;
const PS_COPULA = ps`(?:이야|이에요|이예요|입니다|이다)`;
/** `죽을 거야` 의 평서·높임·소리 나는 대로 쓴 꼴. `-임`·`-음` 은 없다(`오늘 죽을 예정임` 은 일감 농담). */
const PS_FUTURE = ps`(?: ?거야| ?거예요| ?거에요| ?겁니다| ?거다| ?꺼야| ?꺼예요| ?꺼에요|래요?)`;
/** `-기로` 뒤의 정하는 동사. `결정했` 은 **이 꼬리 안에서만** 받는다 — 맨 `결정했어` 는 다짐 동사가 아니다. */
const PS_KIRO_DECISION = ps`(?:했|결심했|결정했|마음 ?먹었|(?:마음 )?정했)(?:어요?|습니다)`;

const PS_FIRST_PERSON = ps`(?:나|난|나는|내가|나도|저|전|저는|제가|저도|우리)`;
/**
 * 시간어. `전에`·`후에`·`뒤에` 는 `식`·`결혼식`·`예식` **바로 뒤**에서만 때다 — 맨 `전에` 는
 * 메시지 첫머리에서 "예전에" 라서(`전에 죽기로 했어. 이제 됐어`) 지난 이야기를 임박으로 읽게 된다.
 */
const PS_CEREMONY_RELATIVE_TIME = ps`(?:식|결혼식|예식) (?:전에|후에|뒤에)`;
const PS_TIME = ps`(?:오늘은?|내일은?|모레|지금|이제는?|이따가?|오늘밤에?|밤에?|새벽에?|주말에?|이번|다음|주에?|달에?|올해|연말에?|(?:식|결혼식|예식)(?:이|만)?|${PS_CEREMONY_RELATIVE_TIME}|끝나고|끝나면)`;
const PS_FUNCTION = ps`(?:진짜로?|정말로?|그냥|그만|다|더는?|이상|너무|꼭|반드시|확실히|이미|벌써|결국|사는 ?(?:게|거)|삶이|모든 (?:것이|게))`;
/** 괴로움을 이유로 대는 서술어. 닫힌 목록이다 — 몸 상태·가벼운 감정은 없다. */
const PS_DISTRESS = psAny(
  ps`힘들어(?:서|요)?|힘들다`,
  ps`괴로워(?:서|요)?|괴롭다`,
  ps`외로워(?:서|요)?|외롭다`,
  ps`우울해(?:서|요)?|우울하다`,
  ps`지쳐(?:서|요)?|지쳤(?:어요?|다)`,
  ps`막막해(?:서|요)?|막막하다`,
  ps`미안해(?:서|요)?|미안하다`,
  ps`무서워(?:서|요)?|무섭다`,
  ps`버거워(?:서|요)?|버겁다`,
  ps`못 버티겠(?:어(?:서|요)?|다)`,
  ps`버틸 수가? 없(?:어(?:서|요)?|다)`,
  ps`살기 싫(?:어(?:서|요)?|다)`,
  ps`의미가? 없(?:어(?:서|요)?|다)`,
  ps`희망이? 없(?:어(?:서|요)?|다)`,
);
const PS_DECISION = psAny(
  ps`결심했(?:어요?|습니다)`,
  ps`마음 ?먹었(?:어요?|습니다)`,
  ps`(?:마음 )?정했(?:어요?|습니다)`,
  ps`준비했(?:어요?|습니다)`,
  ps`준비 다 했(?:어요?|습니다)`,
  ps`됐(?:어요?|습니다)`,
  ps`(?:다 )?정리했(?:어요?|습니다)`,
);
/** 작별 꼬리. `죄송`·`감사` 는 `미안`·`고마웠어` 의 높임 짝이라 같이 받는다. */
const PS_FAREWELL = psAny(
  ps`미안(?:해요?)?`,
  ps`죄송(?:해요|합니다)`,
  ps`안녕`,
  ps`잘 있어요?`,
  ps`잘 지내요?`,
  ps`(?:그동안 )?고마웠(?:어요?|습니다)`,
  ps`그동안 고마워요?`,
  ps`(?:그동안 )?감사했(?:어요|습니다)`,
);
const PS_FILLER = psAny(
  PS_FIRST_PERSON,
  PS_TIME,
  PS_FUNCTION,
  PS_DISTRESS,
  PS_DECISION,
  PS_FAREWELL,
);

/**
 * 계획 칸에 자살을 적는 서술. `다음 할 일은 자살이야`·`오늘 할 일: 자살`.
 * `일정`·`스케줄` 은 **일부러** 칸 명사가 아니다 — `오늘 남은 일정은 자살이야` 는
 * 빡빡한 일정을 빗대는 흔한 말이다.
 */
const PS_PLAN_SLOT = ps`(?:(?:다음|마지막(?:으로)?|남은|오늘|내|제|이제|내가|제가) ){1,2}(?:해야 할 ?일|할 ?일|계획|목표|투두|to ?do|todo)(?:은|는)? (?:(?:자살|죽는 (?:것|거|일))(?:이야|야|이에요|이예요|예요|에요|입니다|이다|다|임|뿐|뿐이야|뿐이에요|뿐입니다|만 남았어요?|만 남겼어요?| 하나야| 하나예요)?|죽는 겁니다)`;
const PS_STRONG_CORE = psAny(
  ps`죽(?:으려|을려|을라)${PS_INTENT_ENDING}${PS_AFTER_INTENT}`,
  ps`죽으려 ${PS_HADA_FORMS}`,
  ps`죽기로 ${PS_KIRO_DECISION}`,
  ps`죽을 (?:예정|계획|작정|생각)${PS_COPULA}`,
  // 날을 정한다. 맨 `날`·요일·`아침` 은 시간어가 아니다(`월요일부터 죽을 예정` 은 일감 농담).
  ps`(?:죽을|자살할?) 날짜?(?:를|을)? (?:정했|잡았)(?:어요?|습니다)`,
  ps`죽는 날(?:을)? (?:정했|잡았)(?:어요?|습니다)`,
  // `죽을 계획했어`·`죽을 준비했어` 는 죽(음식) 얘기로 읽혀서 뺐다. `됐어` 꼴은 음식으로 비문이다.
  ps`죽을 (?:작정|생각) ?했(?:어요?|습니다)`,
  ps`죽을 준비가?(?: 다)? ?됐(?:어요?|습니다)`,
  ps`자살할 (?:예정|계획|생각)${PS_COPULA}`,
  ps`자살할(?:${PS_FUTURE}|게요?)`,
  ps`자살 (?:예정|계획)${PS_COPULA}`,
  ps`자살 ?(?:결심|계획) ?했(?:어요?|습니다)`,
  ps`자살(?:하려|할려|할라)${PS_INTENT_ENDING}${PS_AFTER_INTENT}`,
  ps`목숨을? 끊(?:으려|을려|을라)${PS_INTENT_ENDING}${PS_AFTER_INTENT}`,
  ps`목숨을? 끊을${PS_FUTURE}`,
  ps`(?:(?:내|제) )?목숨을? 끊기로 ${PS_KIRO_DECISION}`,
  ps`생을? 마감하려${PS_INTENT_ENDING}${PS_AFTER_INTENT}`,
  ps`생을? 마감할${PS_FUTURE}`,
  ps`생을? 마감하기로 ${PS_KIRO_DECISION}`,
  PS_PLAN_SLOT,
);
/** 과장으로도 흔한 핵. 시간어가 같은 메시지에 있을 때만 센다. */
const PS_WEAK_CORE = ps`죽을(?:${PS_FUTURE}|게요?)`;
/**
 * 약한 핵을 세워 주는 시간어. `곧` 은 어휘에도 없다 — `곧 죽을 거야` 는 앞 메시지에서 말한
 * 기기·화분·편찮은 어른을 두고도 똑같이 쓴다. 맨 `이번`·`다음`·`식` 도 혼자서는 때가 아니고,
 * `전에`·`후에`·`뒤에` 는 `식`·`결혼식`·`예식` 바로 뒤에서만 때다(두 낱말짜리 구).
 */
const PS_WEAK_CORE_TIME = ps`(?:오늘은?|내일은?|모레|지금|이제는?|이따가?|오늘밤에?|밤에?|새벽에?|주말에?|주에|달에|올해|연말에?|끝나고|끝나면|${PS_CEREMONY_RELATIVE_TIME})`;

const PLANNED_STATEMENT_WHOLE_MESSAGE_PATTERN = new RegExp(
  `^(?:${PS_FILLER} )*${psAny(PS_STRONG_CORE, PS_WEAK_CORE)}(?: ${psAny(PS_FILLER, PS_STRONG_CORE, PS_WEAK_CORE)})*$`,
);
const PLANNED_STATEMENT_STRONG_CORE_PATTERN = new RegExp(
  `(?:^| )${PS_STRONG_CORE}(?= |$)`,
);
/** 토큰 경계에 선 시간어(두 낱말짜리 `결혼식 전에` 포함). 정규화한 메시지 전체에 건다. */
const PLANNED_STATEMENT_WEAK_CORE_TIME_PATTERN = new RegExp(`(?:^| )${PS_WEAK_CORE_TIME}(?= |$)`);
/** 맨 `-어` 괴로움 서술어 + `죽을 예정` — `-어 죽다` 과장 관용구의 계획 꼴(아래 설명 참고). */
const PLANNED_STATEMENT_BARE_DISTRESS_BEFORE_SCHEDULED_CORE_PATTERN =
  /(?:^| )(?:힘들어|괴로워|외로워|우울해|지쳐|막막해|무서워|버거워) 죽을 예정/u;
/**
 * `-어 죽-` 과장 관용구의 핵 **바로 앞**에 온 괴로움 서술어. 그 관용구는 `죽으려-`(`힘들어
 * 죽으려고`·`무서워 죽으려고 함`)와 약한 핵(`힘들어 죽을 거야`·`지쳐 죽을래`)에만 있고, 대개
 * 앞 메시지에서 말한 남의 얘기다. 그래서 이 두 핵 앞에서는 `-서` 꼴(`힘들어서 죽으려고`)만
 * 이유로 받는다. `죽기로 했어` 앞의 맨 꼴(`힘들어 죽기로 했어`)은 관용구 모양이 아니라서
 * 막지 않는다. `죽을 예정` 앞의 맨 `-어` 꼴(`힘들어 죽을 예정`)은 관용구의 계획 꼴이라 따로
 * 막는다(`PLANNED_STATEMENT_BARE_DISTRESS_BEFORE_SCHEDULED_CORE_PATTERN`, 3차 재검사). `지쳤어
 * 죽을 예정이야`·`힘들다 죽을 예정이야` 는 `-어` 연결이 아니라 서 있다. 전역 정규식이지만 `String#match` 로만
 * 쓴다(`match` 는 시작할 때 `lastIndex` 를 0 으로 돌린다).
 */
const PLANNED_STATEMENT_DISTRESS_BEFORE_IDIOM_CORE_PATTERN = new RegExp(
  `(?:^| )${PS_DISTRESS} (?=죽(?:으려|을려|을라)|${PS_WEAK_CORE}(?: |$))`,
  "g",
);
/**
 * 임박상 뒤의 `죽으려-` 핵. `화분 다 죽으려고 함`·`벌써 죽으려고 하고 있어`·`이미 죽으려고
 * 함`·`모든 게 죽으려고 함` 처럼 사람 아닌 주어의 임박상으로 흔하고, 사이에 강조어 하나가
 * 껴도(`다 진짜 죽으려고 함`) 같다. 1인칭 토큰이나 굳은 다짐(`결심했어`·`마음먹었어`·
 * `정했어`)이 같은 메시지에 없으면 서지 않는다. `준비했어` 는 굳은 다짐이 아니다.
 */
const PLANNED_STATEMENT_ASPECT_BEFORE_INTENT_PATTERN = new RegExp(
  `(?:^| )(?:다|벌써|이미|모든 (?:것이|게))(?: ${PS_FUNCTION})? 죽(?:으려|을려|을라)`,
);
const PLANNED_STATEMENT_FIRM_DECISION_PATTERN =
  /(?:^| )(?:결심했|마음 ?먹었|(?:마음 )?정했)(?:어요?|습니다)(?= |$)/;
const PLANNED_STATEMENT_FIRST_PERSON_TOKEN_PATTERN = new RegExp(`^${PS_FIRST_PERSON}$`);
/** 이보다 긴 메시지는 보지 않는다. 계획형 진술은 짧고, 정규식의 되짚기도 묶인다. */
const PLANNED_STATEMENT_MAX_TOKENS = 16;
/**
 * 웃음 표시. 이 관문과 아래 물음표 관문은 **정규화본에서만** 본다. `classifyAmoraCrisis` 와
 * 범위 분류는 정규화한 글을 이 판정기에 넘기므로, 원문에서만 보이는 표시로 막으면 원문을 받는
 * `assessAmoraSafetyText` 와 판정이 갈린다(호환 자모 U+314E + U+314F 는 정규화에서 `하` 로 모인다).
 * 호환 자모(U+314B·U+314E)는 NFKC 에서 첫가끝 자모(U+110F·U+1112)가 되고, 반각(U+FFBB·U+FFBE)도
 * 같은 곳으로 간다 — 목록에는 셋 다 둔다. 글자에 붙은 웃음 자모(`죽으려고` + U+314B)도 음절로
 * 합쳐지지 않으므로 여기서 걸린다. NFD 로 쪼개 들어온 `할`·`해`·`힘` 은 NFKC 가 다시 모으므로
 * 첫소리 U+1112 를 웃음으로 읽지 않는다.
 *
 * 눈웃음(`^^`·`^_^`·`^-^`·`^^;`)과 웃는 얼굴 이모지(해골·녹는 얼굴 포함)도 웃음 표시다.
 *
 * 이 관문과 아래 물음표 관문은 **이중 잠금**이다. 오늘은 웃음 자모·`?`·`^^`·웃는 얼굴이 장식도
 * 구분자도 아니라서 어휘 밖 토큰으로도 걸린다. 누가 나중에 장식·구분자 목록을 넓혀도 열리지
 * 않게 따로 둔다 — 스크래치 변형으로 확인했다: 목록만 넓히면 초록, 목록을 넓히고 이 관문을
 * 지우면 빨강.
 */
const PLANNED_STATEMENT_LAUGH_PATTERN =
  /[\u{314B}\u{314E}\u{110F}\u{1112}\u{11BF}\u{11C2}\u{FFBB}\u{FFBE}]|lol|\^[^\s^]{0,3}\^|[\u{1F602}\u{1F923}\u{1F606}\u{1F604}\u{1F601}\u{1F605}\u{1F639}\u{1F61D}\u{1F61C}\u{1F92A}\u{1F61B}\u{1F600}\u{1F603}\u{1F642}\u{1F643}\u{1F609}\u{1F60A}\u{1F607}\u{1F92D}\u{1F480}\u{1FAE0}]/iu;
/**
 * 물음표. 전각 물음표(U+FF1F)와 물음 이모지(U+2753·U+2754)도 물음이다. U+2047–2049 는 NFKC 에서
 * `??`·`?!`·`!?` 가 되어 `?` 로 걸린다.
 *
 * 그리스 물음표 U+037E 는 **목록에 없다.** NFC 에서 이미 `;` 로 바뀌는 글자라(정준 분해) 정규화본
 * 에는 남지 않는다. 겹느낌표 U+203C 도 NFKC 에서 `!!` 가 된다. 둘을 원문에서만 막으면 두 입구가
 * 갈리고, 고정 안내는 정규화본을 보는 쪽(`classifyAmoraCrisis`)이 정하므로 막은 효과도 없다.
 * 그래서 이 둘은 `;`·`!!` 를 쓴 같은 문장과 똑같이 판정된다.
 */
const PLANNED_STATEMENT_QUESTION_PATTERN =
  /[?\u{FF1F}\u{00BF}\u{061F}\u{2047}\u{2048}\u{2049}\u{203D}\u{2753}\u{2754}]/u;
/**
 * 걷어내는 장식은 우는 자모(U+3160·U+315C 와 그 정규화 꼴 U+1172·U+116E)와 **짧은 허용
 * 목록**의 이모지뿐이다 — 우는·슬픈 얼굴(U+1F622 U+1F62D U+1F61E U+1F614 U+1F63F U+1F641
 * U+2639)과 부서진 하트(U+1F494). 피부색(U+1F3FB–1F3FF)이나 VS16 이 붙어도 같은 장식이다.
 * ZWJ 는 정규화가 이미 지웠으므로 ZWJ 로 붙어 있던 다음 그림은 따로 남아 토큰이 된다.
 *
 * 애원하는 얼굴(U+1F97A)과 두 손 모음(U+1F64F)은 **장식이 아니다.** 한국어 채팅에서 부탁·감사·
 * 애교에 흔해서(`오늘 죽을 예정이야` + U+1F97A) 슬픔 표시로 걷어낼 수 없다.
 *
 * 그 밖의 그림 문자(U+1F000–1FAFF·U+2600–27BF 의 나머지, 국기, 키캡, 둘러싼 글자)는
 * **걷지 않는다.** 토큰으로 남아 메시지를 어휘 밖으로 만든다 — 이모지는 주어·이유·농담·물음을
 * 실을 수 있다(휴대폰 + `곧 죽으려고`, `오늘` + 맥주 + `죽을 예정이야`).
 */
const PLANNED_STATEMENT_DECORATION_PATTERN =
  /[\u{1F622}\u{1F62D}\u{1F61E}\u{1F614}\u{1F63F}\u{1F641}\u{2639}\u{1F494}][\u{1F3FB}-\u{1F3FF}\u{FE0F}]*|[\u{3160}\u{315C}\u{1172}\u{116E}]+/gu;
/**
 * 구분자만으로 된 얼굴 — 눈 둘이 같고 입이 다른 세 글자(`-.-`·`-,-`·`.-.`·`:-:`·`·-·`). 구분자로
 * 녹여 없애면 `^^` 와 같은 말투 표시가 사라진다. 그래서 구분자를 걷기 전에 어휘 밖 토큰
 * (U+E000, 사용자 글에 올 일이 없는 사용 영역 글자)으로 바꾼다. 우는 얼굴 `;-;` 은 우는 자모와
 * 같은 장식이라 뺐다. 같은 글자 셋(`...`·`---`)은 말줄임·줄표라서 얼굴이 아니다.
 */
const PLANNED_STATEMENT_SEPARATOR_FACE_PATTERN = /(?!;-;)([-.,:;\u{B7}])(?!\1)[-.,]\1/gu;
const PLANNED_STATEMENT_OUT_OF_VOCABULARY_TOKEN = " \u{E000} ";
const PLANNED_STATEMENT_SEPARATOR_PATTERN = /[\s.,!~;:·\-–—]+/gu;

function isPlannedFirstPersonDeathStatement(value: string): boolean {
  // 정규화기는 한 번에 멱등이 아니다 — 호환 자모 사이에 서식 문자가 끼면 NFKC 뒤에 걷혀서
  // 두 번째에야 음절로 합쳐진다. 분류 입구는 두 번 정규화하므로 여기서 한 번 더 맞춘다(3차 재검사).
  const text = normalizeAmoraSafetyText(value).normalize("NFKC");
  if (!/죽|자살|목숨|마감/.test(text)) return false;
  // 웃음·물음 관문은 정규화본에서만 본다 — 두 입구(원문·정규화본)가 같은 판정을 내게.
  if (
    PLANNED_STATEMENT_LAUGH_PATTERN.test(text)
    || PLANNED_STATEMENT_QUESTION_PATTERN.test(text)
  ) {
    return false;
  }
  const canonical = text
    .toLowerCase()
    .replace(PLANNED_STATEMENT_SEPARATOR_FACE_PATTERN, PLANNED_STATEMENT_OUT_OF_VOCABULARY_TOKEN)
    .replace(PLANNED_STATEMENT_DECORATION_PATTERN, " ")
    .replace(PLANNED_STATEMENT_SEPARATOR_PATTERN, " ")
    .trim();
  if (!canonical) return false;
  const tokens = canonical.split(" ");
  if (tokens.length > PLANNED_STATEMENT_MAX_TOKENS) return false;
  if (!PLANNED_STATEMENT_WHOLE_MESSAGE_PATTERN.test(canonical)) return false;
  const distressBeforeIdiomCore =
    canonical.match(PLANNED_STATEMENT_DISTRESS_BEFORE_IDIOM_CORE_PATTERN) ?? [];
  if (distressBeforeIdiomCore.some((span) => !span.endsWith("서 "))) return false;
  // `힘들어 죽을 예정`·`무서워 죽을 예정` 도 `-어 죽다` 과장의 계획 꼴이다(3차 재검사).
  // 맨 `-어` 연결만 막는다 — `지쳤어 죽을 예정이야`·`힘들다 …`·`힘들어서 …` 는 그대로 선다.
  if (PLANNED_STATEMENT_BARE_DISTRESS_BEFORE_SCHEDULED_CORE_PATTERN.test(canonical)) return false;
  if (
    PLANNED_STATEMENT_ASPECT_BEFORE_INTENT_PATTERN.test(canonical)
    && !tokens.some((token) => PLANNED_STATEMENT_FIRST_PERSON_TOKEN_PATTERN.test(token))
    && !PLANNED_STATEMENT_FIRM_DECISION_PATTERN.test(canonical)
  ) {
    return false;
  }
  return (
    PLANNED_STATEMENT_STRONG_CORE_PATTERN.test(canonical)
    || PLANNED_STATEMENT_WEAK_CORE_TIME_PATTERN.test(canonical)
  );
}

/**
 * 본문이 `나 자살할 거야` 에 오늘 내는 것과 **같은 모양**이다(자기·자기 향함·의사·임박·
 * 긍정·고백). 뒤의 소비자(`classifyAmoraCrisis`·범위 분류·채팅 라우트의 이른 반환·
 * 모바일 전달 계획)는 그 문장과 똑같이 다룬다.
 */
function plannedFirstPersonDeathStatementAssessment(): AmoraSafetyAssessment {
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
        temporality: "impending",
        polarity: "affirmed",
        context: "disclosure",
      },
    ],
  };
}

/**
 * 닫힌 어휘 규칙들이 함께 쓰는 토큰화. 위 계획형 진술 규칙(`isPlannedFirstPersonDeathStatement`)의
 * 앞단과 **같은 단계, 같은 상수**다 — 정규화 두 번(NFKC), 웃음·물음 관문(정규화본에서만),
 * 구분자 얼굴 → 어휘 밖 토큰, 허용 목록 장식 걷기, 구분자로 끊기. 웃음·물음 표시가 있거나
 * 남는 것이 없으면 `null` 이다.
 *
 * 계획형 진술 규칙은 이 함수를 부르지 않는다(그 본문은 한 글자도 바꾸지 않았다). 아래 자해
 * 생각·수단 규칙과 `partnerViolenceClosedVocabulary.ts` 가 부른다. 세 규칙이 같은 문장을 같은
 * 토큰으로 읽어야 "장식·웃음·물음" 판단이 규칙마다 갈리지 않는다.
 */
export function canonicalizeClosedVocabularyMessage(value: string): string | null {
  const text = normalizeAmoraSafetyText(value).normalize("NFKC");
  if (
    PLANNED_STATEMENT_LAUGH_PATTERN.test(text)
    || PLANNED_STATEMENT_QUESTION_PATTERN.test(text)
  ) {
    return null;
  }
  const canonical = text
    .toLowerCase()
    .replace(PLANNED_STATEMENT_SEPARATOR_FACE_PATTERN, PLANNED_STATEMENT_OUT_OF_VOCABULARY_TOKEN)
    .replace(PLANNED_STATEMENT_DECORATION_PATTERN, " ")
    .replace(PLANNED_STATEMENT_SEPARATOR_PATTERN, " ")
    .trim();
  return canonical || null;
}

/* ────────────────────────────────────────────────────────────────────────────
 * 자해 생각·수단 모으기 규칙 (2026-09-26)
 *
 * 평가에서 공유 레인(`continue:shared`)으로 저장된 자해 문장 넷 중 셋이 이 자리다:
 * `자살 생각이 자꾸 나`·`요즘 자살 생각해`·`수면제 모아뒀어`. 운영은 `자살 생각이 나`·
 * `자살 생각 들어` 는 옛 정규식 갈래로 잡지만(`classifyAmoraCrisis`), 그 사이에 채움말
 * (`자꾸`)이 끼거나 서술어가 `해` 로 바뀌면 놓친다. 수단을 모았다는 말은 아예 갈래가 없다.
 *
 * 계획형 진술 규칙과 **같은 구조**다.
 *  1. 덧붙이기만 한다. 본문과 계획형 진술 규칙이 아무것도 못 찾았을 때(`inconclusive`)만 본다.
 *  2. 메시지의 **모든** 토큰이 아래 닫힌 어휘여야 한다. `^…$` 로 메시지 전체를 맞춘다.
 *  3. 웃음·물음 표시가 있으면 서지 않는다(`canonicalizeClosedVocabularyMessage`).
 *
 * 핵은 둘이다.
 *  (i)  자살·자해 생각/충동 + 닫힌 서술어: `나`·`들어`·`해`·`있어` 의 현재형과 `생각 중이야`.
 *       과거형(`났어`·`했어`)은 없다 — `예전에` 같은 말 없이도 지난 일을 말할 수 있어서다.
 *  (ii) 수단 명사 + `모으다` 의 닫힌 활용형(`모아뒀어`·`모아 놨어`·`모았어`·`모으고 있어`).
 *       `사뒀어` 는 없다 — `번개탄 사뒀어`·`수면제 사뒀어` 는 캠핑·불면의 평범한 말이다.
 *
 * 어휘 규칙: 서술어는 위의 활용형뿐이다. 채움말은 빈도·때 부사와 1인칭뿐이다 — 주어·이유·
 * 물건을 실을 수 있는 낱말은 없다. `너`·`엄마가`·`예전에`·`안`·`없어`·`본 적` 이 하나라도
 * 있으면 서지 않고 운영 판정이 남는다. `다`(`약 다 모아놨어` = 한곳에 챙겨 뒀다)와 `우리` 도
 * 일부러 뺐다.
 *
 * **`모아 두다` 는 짐 싸기 말이기도 하다(2026-09-27 백상자 검토).** 신혼여행 D-1 체크리스트가
 * "복용 중인 약과 목적지 반입 규정 확인"을 묻는다(`apps/web/src/constants/moments.ts`). 그 물음의
 * 가장 짧은 답(`약 이미 모아뒀어`·`제가 약 모아놨어요`·`진통제 벌써 모아뒀어요`)이 이 어휘 안에
 * 그대로 들어가 즉시 위기 고정 안내로 갔다 — 19문장, 원문 소실. 그래서 아래 셋을 좁혔다.
 *  - 수단 명사는 **모아 둘 평범한 까닭이 드문 것만** 둔다. 맨 `약`·`알약`·`진통제`·`처방약` 은
 *    상비약을 포함하는 상위어라 뺐다(`상비약` 을 뺀 것과 같은 까닭). `농약`·`제초제` 는 폐기·
 *    정리로 모으는 물건이라 뺐다.
 *  - 모으는 모습의 부사에서 완료·수량·분배를 말하는 `이미`·`벌써`·`많이`·`하나씩` 을 뺐다.
 *    `수면제 이미 모아뒀어` 는 짐을 다 쌌다는 보고와 같은 모양이다(`하나씩` = 한 사람에 하나씩).
 *    남긴 `몰래`·`조금씩`·`틈틈이` 는 짐 싸기로 읽히지 않는다.
 *  - 1인칭은 화제 꼴만 받는다. `제가 약 모아놨어요`·`저도 약 모아뒀어요` 는 "누가 챙겼어?" 의
 *    답이거나 맞장구다.
 * 그 값으로 `이미 수면제 많이 모아놨어`·`약 모아뒀어` 는 이 규칙 밖이다(검사의 `KNOWN_COST`).
 *
 * 판정은 본문이 `나 자살 생각해` 에 오늘 내는 것과 같은 모양이다(아래 함수).
 *
 * 알고 남긴 것: 계획형 진술 규칙과 같다. 앞 메시지에 주어를 두고 조각만 보낸 말(`또 자살
 * 생각해` 가 남 얘기의 뒷절일 때)은 선다. 과거형·`극단적인 생각`·`죽고 싶은 생각` 류는
 * 이 규칙 밖이다(`죽고 싶` 은 본문이 이미 잡는다).
 * ──────────────────────────────────────────────────────────────────────────── */
/** 1인칭. `우리` 는 없다 — `우리 자살 생각해` 는 1인칭 고백으로 읽을 수 없다. */
const SI_FIRST_PERSON = ps`(?:나|난|나는|내가|나도|저|전|저는|제가|저도)`;
/** 빈도·때 부사. 닫힌 목록이다. */
const SI_ADVERB = ps`(?:자꾸|요즘|요즘은|요즘엔|요새|계속|매일|맨날|또|자주|가끔|문득|오늘|오늘도|밤마다|진짜|정말)`;
const SI_FILLER = psAny(SI_FIRST_PERSON, SI_ADVERB);
const SI_HEAD = ps`(?:자살|자해) ?(?:생각|충동)`;
const SI_PRED_NA = ps`(?:나|나요|난다|납니다)`;
const SI_PRED_DEUL = ps`(?:들어|들어요|든다|듭니다)`;
const SI_PRED_ISS = ps`(?:있어|있어요|있습니다)`;
const SI_PRED_HAE = ps`(?:해|해요|한다|합니다|하고 있어|하고 있어요|하고 있습니다)`;
const SI_CORE = psAny(
  // 떨어진 서술어 — 사이에 채움말이 낄 수 있다: `자살 생각이 자꾸 나`·`자해 충동이 요즘 들어`.
  ps`${SI_HEAD}(?:이|은|도)?(?: ${SI_FILLER})* ${psAny(SI_PRED_NA, SI_PRED_DEUL, SI_PRED_ISS)}`,
  ps`${SI_HEAD}(?:을|은|도)?(?: ${SI_FILLER})* ${SI_PRED_HAE}`,
  ps`${SI_HEAD} ?중(?:이야|이에요|입니다)`,
  // 붙여 쓴 서술어: `자살 생각나`·`자살생각해`·`자살 생각하고 있어`.
  ps`${SI_HEAD}(?:나|나요|난다|납니다|해|해요|한다|합니다)`,
  ps`${SI_HEAD}하고 있(?:어|어요|습니다)`,
);
const SELF_HARM_IDEATION_WHOLE_MESSAGE_PATTERN = new RegExp(
  `^(?:${SI_FILLER} )*${SI_CORE}(?: ${SI_FILLER})*$`,
);

/**
 * 자해 수단. 모아 둘 평범한 까닭이 드문 것만 둔다. `상비약`·`영양제` 는 없다 — 모아 두는 것이
 * 평범한 물건이다. 맨 `약`·`알약`·`진통제`·`처방약` 도 없다 — 상비약을 포함하는 상위어라서
 * `약 이미 모아뒀어` 가 신혼여행 짐 싸기 답과 같은 모양이다. `농약`·`제초제` 는 폐기·정리로
 * 모으는 물건이라 없다.
 */
const SM_MEANS = ps`(?:수면제|수면 ?유도제|수면약|신경 ?안정제|안정제|우울증 ?약|항우울제|번개탄)(?:을|를)?`;
const SM_GATHER = psAny(
  ps`모아 ?(?:뒀|두었|놨|놓았)(?:어|어요|습니다|다)`,
  ps`모았(?:어|어요|습니다|다)`,
  ps`모으고 있(?:어|어요|습니다|다)`,
  ps`모으는 중(?:이야|이에요|입니다)`,
);
/**
 * 모으는 모습의 부사. `다` 는 없다 — `약 다 모아놨어` 는 한곳에 챙겨 뒀다는 말이다.
 * `이미`·`벌써`(완료)·`많이`(수량)·`하나씩`(분배)도 없다 — 짐을 다 쌌다는 보고와 같은 모양이다.
 */
const SM_ADVERB = ps`(?:몰래|조금씩|틈틈이|요즘|요새|계속|매일|자꾸|또|진짜|정말)`;
/**
 * 수단 모으기의 1인칭은 화제 꼴(`나`·`저는`)만 받는다. `제가`·`내가`(누가 했나에 대한 답)와
 * `저도`·`나도`(남의 말에 맞장구)는 없다 — `제가 수면제 모아놨어요` 는 "약 누가 챙겼어?" 의 답과
 * 같은 모양이다.
 */
const SM_FIRST_PERSON = ps`(?:나|난|나는|저|전|저는)`;
const SM_FILLER = psAny(SM_FIRST_PERSON, SM_ADVERB);
const SELF_HARM_MEANS_WHOLE_MESSAGE_PATTERN = new RegExp(
  `^(?:${SM_FILLER} )*${SM_MEANS}(?: ${SM_FILLER})* ${SM_GATHER}(?: ${SM_FILLER})*$`,
);
/** 계획형 진술 규칙과 같은 상한. */
const SELF_HARM_IDEATION_MAX_TOKENS = 16;

function isClosedSelfHarmIdeationOrMeansStatement(value: string): boolean {
  const canonical = canonicalizeClosedVocabularyMessage(value);
  if (!canonical) return false;
  if (canonical.split(" ").length > SELF_HARM_IDEATION_MAX_TOKENS) return false;
  return (
    SELF_HARM_IDEATION_WHOLE_MESSAGE_PATTERN.test(canonical)
    || SELF_HARM_MEANS_WHOLE_MESSAGE_PATTERN.test(canonical)
  );
}

/**
 * 본문이 `나 자살 생각해`(1인칭 + 자살 생각) 에 오늘 내는 것과 **같은 모양**이다.
 * 뒤의 소비자는 그 문장과 똑같이 다룬다(즉시 위기 → 원문 저장 없이 고정 안내).
 */
function closedSelfHarmIdeationAssessment(): AmoraSafetyAssessment {
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
        temporality: "impending",
        polarity: "affirmed",
        context: "disclosure",
      },
    ],
  };
}

export function assessAmoraSafetyText(value: string): AmoraSafetyAssessment {
  const base = assessAmoraSafetyTextBase(value);
  // `inconclusive` 는 본문이 끝까지 내려가 **아무 갈래에도 안 걸렸다**는 뜻이다.
  // 그 밖의 판정은 본문이 뭔가를 보고 내린 결론이므로 손대지 않는다.
  if (base.resolution !== "inconclusive") return base;
  if (isPlannedFirstPersonDeathStatement(value)) {
    return plannedFirstPersonDeathStatementAssessment();
  }
  // 2026-09-26: 계획형 진술 규칙도 못 찾았을 때만 본다.
  return isClosedSelfHarmIdeationOrMeansStatement(value)
    ? closedSelfHarmIdeationAssessment()
    : base;
}

/**
 * **검사 전용.** 자해 생각·수단 규칙만 뺀 판정(= 본문 + 계획형 진술 규칙 = 이 규칙을 더하기
 * 전의 판정). `closedSelfHarmIdeationIsACrisis.test.ts` 가 "새 규칙이 잡은 행 말고는 전부
 * 이것과 똑같다" 를 행마다 대조하는 데 쓴다. 제품 코드에서 부르지 않는다.
 */
export function assessAmoraSafetyTextWithoutClosedSelfHarmIdeationRuleForTests(
  value: string,
): AmoraSafetyAssessment {
  const base = assessAmoraSafetyTextBase(value);
  if (base.resolution !== "inconclusive") return base;
  return isPlannedFirstPersonDeathStatement(value)
    ? plannedFirstPersonDeathStatementAssessment()
    : base;
}

/**
 * **검사 전용.** 계획형 진술 규칙을 뺀 판정(= origin/main db249054 의 판정).
 * `terminalDeathIntentIsACrisis.test.ts` 가 "새 규칙이 잡은 행 말고는 전부 이것과
 * 똑같다" 를 행마다 대조하는 데 쓴다. 제품 코드에서 부르지 않는다.
 */
export function assessAmoraSafetyTextWithoutPlannedStatementRuleForTests(
  value: string,
): AmoraSafetyAssessment {
  return assessAmoraSafetyTextBase(value);
}
