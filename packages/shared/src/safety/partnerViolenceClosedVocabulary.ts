import { canonicalizeClosedVocabularyMessage } from "./amoraCrisisClassifier";

/* ────────────────────────────────────────────────────────────────────────────
 * 친밀한 관계의 폭력·위협·통제 서술 — 닫힌 어휘 (2026-09-26)
 *
 * ## 왜 있나
 *
 * 아모라 대화의 기본 레인은 '함께(공유)'다. 판정이 `continue` 면 요청한 레인에 저장되고,
 * 저장되는 순간 배우자가 읽는다. 평가에서 다음 다섯 문장이 전부 공유 레인에 남았다:
 * `남편이 때려요`·`밀쳐서 멍들었어`·`술 먹으면 때려요`·`파혼하면 죽인대`·`친구 못 만나게 해`.
 * 가해자가 배우자라면 피해자의 도움 요청을 가해자가 읽는다.
 *
 * ## 무엇을 하나
 *
 * 메시지 **전체**가 아래 닫힌 어휘로 된 폭력·위협·통제 서술일 때만 참이다. 참이면
 *  - `planAmoraCrisisDelivery` 가 비즉시 안전 경로로 보낸다(아모라 → 나만 레인, 상대 → 보류).
 *  - 웹 범위 분류가 W2 safety(도구 0·112·1366 안내)로 보낸다.
 * 두 곳 모두 **운영 판정이 아무것도 못 찾았을 때만** 이 함수를 본다. 즉시 위기를 비즉시로
 * 내리거나 운영이 무른 문장(`no_safety_signal`)을 뒤집지 않는다. 더하기만 한다.
 *
 * ## 설계 — 세는 목록이 아니라 닫힌 어휘
 *
 *  1. 모든 토큰이 어휘 안이어야 한다. 모르는 토큰이 하나라도 있으면 거짓이다. 패턴은 `^…$`.
 *  2. 웃음·물음 표시가 있으면 서지 않는다(`canonicalizeClosedVocabularyMessage`, 위기 분류기의
 *     계획형 진술 규칙과 같은 토큰화).
 *  3. 명사(호칭·신체 부위·조건)는 넓혀도 된다. **서술어는 닫힌 활용형만** 받는다. 위험한 것은
 *     명사가 아니라 서술어다.
 *  4. 동형어는 뺀다.
 *     - `맞아요`·`맞았어` 는 `옳다` 로도 읽힌다(`신랑이 맞았어` = 신랑 말이 옳았다). 피동 `맞았어` 는
 *       `(호칭)한테/에게` 가 같은 메시지에 있을 때만 받는다. `맞아요` 는 아예 없다.
 *     - 맨 `찼어` 는 `헤어졌다` 로 읽힌다(`여친이 날 찼어`). `발로 찼어`·`걷어찼어` 만 받고,
 *       그것도 호칭 주어나 1인칭 목적어가 있을 때만 받는다(`어제 다리를 걷어찼어` 는 주어가
 *       누구인지 모른다).
 *     - `밀어요`(밀다)·`때려잡`·`때려줘`·`세게 때려`(운동)는 목록 밖이다.
 *     - 반말 `때려`·`밀쳐`·`목 졸라`·`때리고` 는 명령과 같은 모양이다(`진짜 때려`·`배 때려`).
 *       호칭 주어·1인칭 목적어·조건절·빈도 부사·다친 결과가 함께 있을 때만 받는다.
 *     - 던지다는 던진 물건(`물건`·`접시` 등)이 적혀 있을 때만 받는다. `신부가 나한테 던졌어`(부케)는
 *       평범한 말이다.
 *     - `오빠`·부모는 호칭이 아니다 — `오빠가 죽인대`·`엄마가 죽인대` 는 흔한 과장이다.
 *     - `죽인다` 는 `끝내준다` 다(`신부가 진짜 죽인대` = 신부가 끝내준대). `가만 안 둔다` 는 혼낸다는
 *       농담이고(`술 먹으면 와이프가 가만 안 둔대`), 업체에 화난 남편 얘기이기도 하다. 그래서 위협
 *       전언(`죽인대`·`때린대`·`가만 안 둔대`·`죽인다고 했어`)은 1인칭 목적어나 떠나려는·거절하는
 *       조건(`파혼하면`·`헤어지면`·`신고하면` …)이 있을 때만 받는다. `술 먹으면`·`화나면` 은 허가가
 *       아니다 — 농담에도 똑같이 붙는다. `협박했어` 라고 적은 것만 혼자 선다.
 *  5. 호칭 없는 문장도 받는다(평가 폭력 다섯 중 넷이 호칭이 없다). 대신 서술어를 엄격하게
 *     닫는다. 호칭이나 1인칭 목적어가 있어야만 폭력으로 읽히는 서술어(접시 던지기·발로 차다·
 *     휴대폰 검사·돈 통제)는 그것이 있을 때만 받는다.
 *
 * ## 알고 남긴 것
 *
 * 메시지 하나를 본다. 앞 메시지에 주어를 두고 조각만 보낸 말(`파혼하면 죽인대` 가 친구의
 * 과장이었을 때)은 선다. 오탐의 값은 누구에게 보냈는지에 따라 다르다.
 *  - 아모라에게 보냈으면 나만 레인에 저장되고, 안전 안내가 붙고, 이 턴은 도구가 0 이다. 원문은
 *    나만 레인에 남는다(원문을 버리는 즉시 위기 고정 안내와 다르다).
 *  - 상대에게 보냈으면 전송이 보류된다. 상대에게 가지 않고 저장되지도 않는다. 원문은 나만 상담
 *    작성창으로 돌아간다. 그 작성창에 이미 글이 있으면 되돌리지 않는다(웹 `ChatContent.tsx`·
 *    `ChatSidePanel.tsx` 의 `restoreHeldComposerText`, 앱 `chat.tsx` 의 `moveHeldDraftToPrivateLane`).
 *    웹에서 붙인 첨부는 버린다.
 * 부모(`엄마가 죽인대` 는 흔한 과장)는 호칭에 넣지 않았다.
 *
 * **잡는 범위는 좁다.** 평가 다섯 문장과 거의 같은 꼴만 옮긴다. 처음 보는 봉인 코퍼스(위험 143행,
 * 2026-09-27 측정)에서는 이 판정이 레인을 옮긴 행이 0 이었다. 도움을 청하는 꼬리(`어떡해요`·
 * `도와주세요`·`무서워요`)나 물음표가 붙거나 이유가 한 마디 붙으면(`남편이 때려서 무서워요`)
 * 어휘 밖이라 서지 않는다. 그 꼬리를 받을지는 오탐과 맞바꾸는 설계 결정이라 여기서 넓히지
 * 않았다. 공유 레인에 남는 위험 서술을 줄이는 큰 손잡이는 이 판정이 아니라 레인 기본값이다
 * (`ChatContent.tsx`·`ChatSidePanel.tsx`·앱 `chat.tsx` 의 `"shared"` 초기값 — 제품 결정).
 * ──────────────────────────────────────────────────────────────────────────── */
const ps = String.raw;
const pvAny = (...alternatives: readonly string[]) => `(?:${alternatives.join("|")})`;

/**
 * 배우자·예비 배우자·연인과 시부모. 명사라서 넓혀도 된다.
 * `오빠` 는 없다 — 형제이기도 해서 `오빠가 죽인대`(남매의 과장)가 선다. 부모도 같은 까닭으로 없다.
 */
const PV_PARTNER_NOUN = pvAny(
  "남편", "신랑", ps`예비 ?신랑`, "예랑이?", "아내", "와이프", "부인", "신부", ps`예비 ?신부`, "예신이?",
  "남친", "여친", ps`남자 ?친구`, ps`여자 ?친구`, "약혼자", "약혼녀", "애인", "배우자",
  ps`그 사람`, ps`그 남자`, ps`그 여자`,
  "시아버지", "시어머니", "시아버님", "시어머님",
);
/** 호칭 + 주어·주제 조사. **이것만** 주어로 센다(맨 호칭은 `남편 휴대폰` 처럼 소유로도 읽힌다). */
const PV_PARTNER_SUBJECT = ps`${PV_PARTNER_NOUN}(?:이|가|은|는|도)`;
/** 피동의 행위자: `남편한테 맞았어`. */
const PV_PARTNER_AGENT = ps`${PV_PARTNER_NOUN}(?:한테|한테서|에게|에게서)`;
/** 1인칭 목적어·받는 이. 폭력의 대상이 화자임을 적는다. */
const PV_FIRST_OBJECT = pvAny(
  "저를", "절", "나를", "날", "저한테", "나한테", "저에게", "나에게", "저한테도", "나한테도",
);
/** 주어로도 목적어로도 읽히는 1인칭과 소유. 채움말일 뿐 허가 토큰이 아니다. */
const PV_FIRST_OTHER = pvAny("나", "저", "나도", "저도", "내", "제", "우리");
const PV_BODY = ps`${pvAny(
  "얼굴", "머리", "뺨", "따귀", "배", "등", "다리", "팔", "어깨", "가슴", "목", "옆구리",
  "정강이", "명치", "눈", "코", "입술", "몸", "온몸",
)}(?:을|를|이|가|에|도)?`;
const PV_INSTRUMENT = pvAny("손으로", "주먹으로", "손바닥으로", "물건으로");
/** 빈도·때 부사. `세게` 는 없다 — `세게 때려` 는 공을 치는 말이기도 하다. */
const PV_ADVERB = pvAny(
  "자꾸", "매일", "맨날", "또", "또다시", "어제", "오늘", "방금", "아까", "계속", "요즘", "요새",
  "자주", "가끔", "항상", "늘", "어젯밤", "어젯밤에", "밤마다", "진짜", "정말", "너무", "심하게",
  ps`몇 번`, ps`몇 번이나`, ps`여러 번`, "처음으로",
);
/** 조건절·때. 폭력을 부르는 상황과 위협의 조건. */
const PV_CONDITION = pvAny(
  ps`술 (?:먹으면|마시면|먹고|마시고|취하면|취해서)`, ps`술만 (?:먹으면|마시면)`, "취하면", "취해서",
  "화나면", ps`화가 나면`, "화나서", ps`화가 나서`, ps`기분 나쁘면`, "싸우면", "싸우다가",
  ps`싸울 때마다`,
  "파혼하면", ps`파혼하자고 하면`, "헤어지면", ps`헤어지자고 하면`, "이혼하면", ps`이혼하자고 하면`,
  ps`연락 안 받으면`, ps`말 안 들으면`, "신고하면", "도망가면", "떠나면", "거절하면",
);
const PV_PAST = ps`(?:어|어요|습니다|다)`;
/** 다친 결과. 혼자서는 폭력이 아니다 — 핵이 있어야 한다. */
const PV_RESULT = pvAny(
  ps`멍(?:이)? ?들었${PV_PAST}`, ps`멍(?:이)? ?들어(?:요)?`,
  ps`(?:코)?피(?:가)? 났${PV_PAST}`, ps`(?:코)?피(?:가)? 나(?:요)?`,
  ps`깁스 ?했${PV_PAST}`, ps`다쳤${PV_PAST}`, ps`넘어졌${PV_PAST}`, ps`부었${PV_PAST}`,
  ps`병원(?:에)? 갔${PV_PAST}`,
);
const PV_FILLER = pvAny(
  PV_PARTNER_SUBJECT, PV_PARTNER_AGENT, PV_PARTNER_NOUN, PV_FIRST_OBJECT, PV_FIRST_OTHER,
  PV_BODY, PV_INSTRUMENT, PV_ADVERB, PV_CONDITION, PV_RESULT,
);

/** 통제 서술의 `하다` 꼴. */
const PV_CONTROL_HADA = ps`(?:해|해요|합니다|한다|함|했어|했어요|했습니다|했다|하고)`;
const PV_ISOLATION_OBJECT = pvAny(
  ps`친구(?:를|들|들을|도|들도)?`, ps`가족(?:을|도)?`, ps`부모님(?:을|도)?`, ps`엄마(?:를|도)?`,
  ps`아빠(?:를|도)?`, ps`친정 ?식구(?:를|들|도)?`, "아무도", ps`사람(?:을|들|들을)?`, ps`동기(?:를|들|들을)?`,
);
const PV_CONTACT_WITH = pvAny(
  ps`친구(?:랑|들이랑|하고|들하고)`, ps`가족(?:이랑|하고)`, ps`부모님(?:이랑|하고)`, ps`엄마(?:랑|하고)`,
);

/**
 * 반말 `-어`·`-고` 꼴(`때려`·`밀쳐`·`목 졸라`·`때리고`)은 **명령·조각과 같은 모양**이다
 * (`진짜 때려`·`배 때려` = 쳐라). 그래서 서술로 읽히게 하는 말이 같은 메시지에 있을 때만 선다:
 * 호칭 주어·1인칭 목적어·조건절·빈도 부사·다친 결과(`PV_DECLARATIVE_CONTEXT`).
 */
const PV_IMPERATIVE_LOOKALIKE_CORE = pvAny(
  "때려", "때리고", "밀쳐", "밀치고", ps`목(?:을|를)? (?:졸라|조르고)`,
);
/** 빈도 부사 — 일이 되풀이된다는 서술. `진짜`·`너무`·`오늘` 은 명령과도 어울려서 없다. */
const PV_FREQUENCY_ADVERB = pvAny(
  "자꾸", "매일", "맨날", "또", "또다시", "계속", "항상", "늘", "자주", "가끔", "요즘", "요새", "밤마다",
  ps`몇 번`, ps`몇 번이나`, ps`여러 번`,
);
/** 혼자 서는 핵 — 이 서술어는 평범한 읽기가 없다(주어가 없어도). */
const PV_STRONG_CORE = pvAny(
  // 때리다
  ps`때려(?:요|서)`, ps`때립니다`, ps`때린다`, ps`때렸${PV_PAST}`, ps`때림`,
  ps`때리려고 (?:해|해요|했어|했어요)`,
  // 밀치다(밀다는 없다)
  ps`밀쳐(?:요|서)`, ps`밀칩니다`, ps`밀친다`, ps`밀쳤${PV_PAST}`, ps`밀침`,
  // 목 조르다 — 능동과 피동
  ps`목(?:을|를)? (?:졸라(?:요|서)|졸랐${PV_PAST}|조름|조릅니다|조른다)`,
  ps`목(?:이|을)? 졸렸${PV_PAST}`,
  // 위협 — `협박` 이라고 적은 것만 혼자 선다. 맨 전언(`죽인대`·`가만 안 둔대`)은 아래
  // `PV_HEARSAY_THREAT_CORE` 로 옮겼다.
  ps`(?:죽인다고|죽이겠다고|죽여 ?버린다고|때린다고|때리겠다고) (?:협박해|협박해요|협박했어|협박했어요)`,
  // 고립 통제. 채팅에서는 표준 표기보다 붙여 쓴 꼴(`못만나게`·`못하게`·`만나게해`)이 흔하고
  // `연락을`·`연락도` 처럼 조사가 붙는다. 띄어쓰기와 조사만 선택으로 두었다 — 서술어는 그대로다
  // (2026-09-27 검토: `친구 못만나게 해`·`연락을 못 하게 해` 가 빠졌다).
  ps`(?:${PV_ISOLATION_OBJECT} )?못 ?만나게 ?${PV_CONTROL_HADA}`,
  ps`(?:${PV_CONTACT_WITH} )?연락(?:을|도)? ?못 ?하게 ?${PV_CONTROL_HADA}`,
  ps`(?:(?:집 ?)?밖에 )?못 ?나가게 ?${PV_CONTROL_HADA}`,
);
/**
 * 위협 전언. **혼자 서지 않는다** — 겨냥한 사람이 화자이거나(1인칭 목적어) 떠나려는·거절하는
 * 조건(`파혼하면`·`헤어지면`·`신고하면` …)이 같은 메시지에 있을 때만 선다(2026-09-27 백상자 검토).
 *
 * 까닭: `죽인다` 는 `끝내준다` 로도 읽힌다. `오늘 신부가 진짜 죽인대`(신부가 끝내준대)·
 * `술 먹으면 신부가 죽인대`·`술 마시면 와이프가 가만 안 둔대`(혼난다는 농담)가 폭력 위협으로
 * 섰다. `남편이 가만 안 둔대` 는 무례한 업체에 화가 난 남편 얘기이기도 하다. 그래서 `술 먹으면`·
 * `화나면` 같은 폭력 상황 조건은 이 핵의 허가가 아니다 — 그 조건은 농담에도 똑같이 붙는다.
 */
const PV_HEARSAY_THREAT_CORE = pvAny(
  ps`죽인대(?:요)?`, ps`죽이겠대(?:요)?`, ps`죽여 ?버린대(?:요)?`, ps`죽여 ?버리겠대(?:요)?`,
  ps`때린대(?:요)?`, ps`때리겠대(?:요)?`, ps`가만 안 (?:둔대|두겠대)(?:요)?`,
  ps`(?:죽인다고|죽이겠다고|죽여 ?버린다고|때린다고|때리겠다고) (?:했어|했어요|했습니다|해|해요|합니다)`,
);
/** 위협 전언을 세우는 조건 — 떠나려 하거나 거절하거나 알리려 할 때. `PV_CONDITION` 의 일부다. */
const PV_SEPARATION_CONDITION = pvAny(
  "파혼하면", ps`파혼하자고 하면`, "헤어지면", ps`헤어지자고 하면`, "이혼하면", ps`이혼하자고 하면`,
  "신고하면", "도망가면", "떠나면", "거절하면",
);
const PV_THROW_VERB = ps`(?:집어 ?)?(?:던져(?:요|서)?|던집니다|던진다|던졌${PV_PAST}|던짐|던지고)`;
/**
 * 던지다는 **던진 물건이 적혀 있을 때만** 핵이다. 맨 `던졌어` 와 `신부가 나한테 던졌어`(부케)는
 * 평범한 말이다. `물건` 은 그 자체로 서고(아래 `THROW_WITH_THINGS_PATTERN`), 그릇·접시 같은 살림은
 * 호칭 주어·1인칭 목적어가 있을 때만 선다(`접시 던졌어` 는 화자 자신일 수 있다).
 */
const PV_THROW_CORE = ps`(?:물건|그릇|접시|컵|리모컨|의자)(?:을|를|도)? ${PV_THROW_VERB}`;
/** 호칭 주어·1인칭 목적어가 있을 때만 서는 핵(없으면 평범한 읽기가 있다). */
const PV_LICENSED_CORE = pvAny(
  PV_THROW_CORE,
  ps`발로(?: ${PV_BODY})? (?:차(?:요|서)?|찼${PV_PAST}|참|차고)`,
  ps`걷어 ?(?:차(?:요|서)?|찼${PV_PAST}|참|차고)`,
  ps`(?:휴대폰|핸드폰|폰|카톡|문자|메시지)(?:을|를|도)? (?:검사(?:해|해요|합니다|한다|했어|했어요|했습니다|함)|뒤져(?:요)?|뒤졌어(?:요)?)`,
  ps`(?:돈|카드)(?:을|를|도)? 못 ?쓰게 ?${PV_CONTROL_HADA}`,
);
/** 피동 — `(호칭)한테/에게` 가 같은 메시지에 있을 때만 선다. `맞아요` 는 없다. */
const PV_PASSIVE_CORE = pvAny(
  ps`맞았${PV_PAST}`, "맞아서", ps`맞고 있(?:어|어요|습니다)`, ps`맞고 (?:살아|살아요|삽니다)`,
);
const PV_ANY_CORE = pvAny(
  PV_STRONG_CORE, PV_HEARSAY_THREAT_CORE, PV_IMPERATIVE_LOOKALIKE_CORE, PV_LICENSED_CORE,
  PV_PASSIVE_CORE,
);
/** 반말 `-어` 꼴을 서술로 읽히게 하는 말. 맨 호칭·`나`·`저` 는 없다(`남편 때려`·`나 때려` 는 명령이기도 하다). */
const PV_DECLARATIVE_CONTEXT = pvAny(
  PV_PARTNER_SUBJECT, PV_FIRST_OBJECT, PV_CONDITION, PV_FREQUENCY_ADVERB, PV_RESULT,
);

const PARTNER_VIOLENCE_WHOLE_MESSAGE_PATTERN = new RegExp(
  `^(?:${PV_FILLER} )*${PV_ANY_CORE}(?: (?:${PV_FILLER}|${PV_ANY_CORE}))*$`,
);
const at = (body: string) => new RegExp(`(?:^| )${body}(?= |$)`);
const STRONG_CORE_PATTERN = at(PV_STRONG_CORE);
const HEARSAY_THREAT_CORE_PATTERN = at(PV_HEARSAY_THREAT_CORE);
const SEPARATION_CONDITION_PATTERN = at(PV_SEPARATION_CONDITION);
const IMPERATIVE_LOOKALIKE_CORE_PATTERN = at(PV_IMPERATIVE_LOOKALIKE_CORE);
const DECLARATIVE_CONTEXT_PATTERN = at(PV_DECLARATIVE_CONTEXT);
const LICENSED_CORE_PATTERN = at(PV_LICENSED_CORE);
const THROW_WITH_THINGS_PATTERN = at(ps`물건(?:을|도)? ${PV_THROW_VERB}`);
const PASSIVE_CORE_PATTERN = at(PV_PASSIVE_CORE);
const PARTNER_SUBJECT_PATTERN = at(PV_PARTNER_SUBJECT);
const PARTNER_AGENT_PATTERN = at(PV_PARTNER_AGENT);
const FIRST_OBJECT_PATTERN = at(PV_FIRST_OBJECT);
/** 폭력 서술은 짧다. 이보다 긴 메시지는 보지 않는다. */
const PARTNER_VIOLENCE_MAX_TOKENS = 16;

/**
 * 메시지 전체가 닫힌 어휘로 된 친밀한 관계 폭력·위협·통제 서술인가.
 *
 * 호출자는 **운영 판정이 아무것도 못 찾았을 때만** 이 함수를 본다
 * (`amoraCrisisDelivery.ts`·`amoraQuestionScope.ts`). 이 함수 자신은 판정을 내리지 않고
 * 참·거짓만 낸다.
 */
export function isClosedPartnerViolenceStatement(value: string): boolean {
  const canonical = canonicalizeClosedVocabularyMessage(value);
  if (!canonical) return false;
  if (canonical.split(" ").length > PARTNER_VIOLENCE_MAX_TOKENS) return false;
  if (!PARTNER_VIOLENCE_WHOLE_MESSAGE_PATTERN.test(canonical)) return false;
  if (STRONG_CORE_PATTERN.test(canonical)) return true;
  if (
    HEARSAY_THREAT_CORE_PATTERN.test(canonical)
    && (FIRST_OBJECT_PATTERN.test(canonical) || SEPARATION_CONDITION_PATTERN.test(canonical))
  ) {
    return true;
  }
  if (
    IMPERATIVE_LOOKALIKE_CORE_PATTERN.test(canonical)
    && DECLARATIVE_CONTEXT_PATTERN.test(canonical)
  ) {
    return true;
  }
  const licensed =
    PARTNER_SUBJECT_PATTERN.test(canonical) || FIRST_OBJECT_PATTERN.test(canonical);
  if (LICENSED_CORE_PATTERN.test(canonical)) {
    if (licensed || THROW_WITH_THINGS_PATTERN.test(canonical)) return true;
  }
  return PASSIVE_CORE_PATTERN.test(canonical) && PARTNER_AGENT_PATTERN.test(canonical);
}
