import type {
  CourtSafetyAssessment,
  CourtSafetyRiskType,
  CourtStatementInput,
} from "@/lib/coupleCourt/types";
import {
  COURT_SELF_HARM_SAFETY_MESSAGE,
  COURT_VIOLENCE_SAFETY_MESSAGE,
} from "@/lib/coupleCourt/support";

export const COURT_SAFETY_POLICY_VERSION = "court-safety-2026-07-13.2";

// Threatening self-harm if a partner leaves is both a self-harm signal and a
// coercive-control signal. Keep the relationship condition close to the harm
// phrase to avoid matching ordinary wedding hyperbole elsewhere in a story.
const CONDITIONAL_SELF_HARM_THREAT_PATTERN =
  /(?:헤어지(?:자고하|면)|파혼하(?:자고하|면)|결혼(?:을)?안하면|결혼안해주면|떠나면|나를떠나면).{0,20}(?:죽어버리겠|죽어버릴거|죽겠(?:대|다고|어|다)?|죽을게|죽을거|목숨(?:을)?끊겠|목숨(?:을)?끊을거|자해하겠|자해할거)/;
const MURDER_SUICIDE_THREAT_PATTERN = /(?:같이|함께)죽자/;

const HIGH_RISK_PATTERNS: ReadonlyArray<{
  category: CourtSafetyRiskType;
  patterns: readonly RegExp[];
}> = [
  {
    category: "self_harm",
    patterns: [
      /죽고싶(?:다|어|어요|습니다)?/,
      /자살(?:하고싶|할거|하겠|시도|생각)/,
      /극단적선택(?:을)?(?:하고싶|하겠|생각|시도)/,
      /내(?:몸|자신|스스로)(?:을|를)?(?:해치|다치게)/,
      /목숨(?:을)?(?:끊|버리)/,
      CONDITIONAL_SELF_HARM_THREAT_PATTERN,
      MURDER_SUICIDE_THREAT_PATTERN,
    ],
  },
  {
    category: "violence",
    patterns: [
      /(?:나|상대|애인|예비(?:신랑|신부)|남자친구|여자친구)(?:을|를)?(?:때렸|밀쳤|폭행|목을졸|발로찼)/,
      /저(?:을|를)?(?:때렸|밀쳤|폭행|목을졸|발로찼)/,
      /상대(?:가|방이).{0,8}(?:때렸|밀쳤|폭행|목을졸|발로찼)/,
      /(?:상대|상대방|애인|예비(?:신랑|신부)|남자친구|여자친구).{0,12}(?:나|저|내|제)?(?:을|를)?(?:때리|때렸|때려|밀치|밀쳤|폭행|목졸|목을졸|발로차|발로찼|손찌검)/,
      /(?:나|저|내|제)(?:을|를)?(?:때리|때렸|때려|밀치|밀쳤|폭행|목졸|목을졸|발로차|발로찼|손찌검)/,
      /(?:맞았|맞고있|맞는중|손찌검을당했)/,
      /(?:폭행|구타)를?(?:당했|당하고|당하는중)/,
      /(?:때리|패|밀치|목졸라|칼로찌르)(?:겠|려고|려했|는중|고있)/,
      /(?:칼|흉기)를?(?:들었|휘둘|겨눴)/,
      /물건(?:을)?(?:던졌|집어던졌|부쉈)/,
    ],
  },
  {
    category: "threat",
    patterns: [
      /(?:죽여버리(?:겠|려고|고싶|겠다고)|죽여버린다고)/,
      /(?:죽인다고|해친다고|죽이겠다고|해치겠다고|죽이려고|해치려고)/,
      /가만두지않(?:겠|는다고)/,
      /(?:나|상대|가족)(?:을|를)?(?:해코지|해치겠)/,
      /(?:사진|영상|비밀)을?(?:퍼뜨리|유포하)(?:겠|겠다고|려고)/,
      /(?:헤어지|파혼하)면.{0,12}(?:죽이|해치|망하게)/,
      /협박(?:했|하겠|받고|당했)/,
    ],
  },
  {
    category: "confinement",
    patterns: [
      /(?:방|집|차)에?(?:가뒀|감금|못나가게)/,
      /문(?:을)?잠그고.{0,10}(?:못나가|가뒀)/,
      /(?:나가지|집에가지|차에서내리지)못하게/,
      /휴대폰(?:을)?뺏고.{0,12}(?:못나가|가뒀)/,
    ],
  },
  {
    category: "stalking",
    patterns: [
      /(?:몰래)?(?:미행|위치추적|위치를추적)/,
      /(?:집|회사|학교)앞에서(?:계속|매일|밤새)?기다렸/,
      /싫다는데.{0,12}(?:계속찾아오|따라다니)/,
      /스토킹(?:하|당하|피해)/,
      /위치공유를?(?:강요|억지로)/,
    ],
  },
  {
    category: "coercive_control",
    patterns: [
      /(?:친구|가족)(?:을|를)?(?:만나지못하게|못만나게|연락하지못하게)/,
      /(?:휴대폰|메신저|연락처|통화내역)을?(?:검사|감시|뒤졌)/,
      /허락없이는?(?:외출|약속|만남)을?(?:못하|금지)/,
      /(?:옷|화장|직장|퇴사|임신)을?(?:강요|통제)/,
      /(?:모든행동|일상|인간관계)를?(?:통제|감시)/,
      CONDITIONAL_SELF_HARM_THREAT_PATTERN,
    ],
  },
  {
    category: "sexual_coercion",
    patterns: [
      /싫다는데.{0,12}(?:성관계|관계|스킨십)/,
      /(?:성관계|성적행동|스킨십)(?:을|를)?(?:강요|억지로)/,
      /동의없이.{0,12}(?:성관계|성적|촬영|사진)/,
      /(?:피임|임신)을?(?:강요|거부하도록강요)/,
      /성적(?:사진|영상)으로?(?:협박|위협)/,
    ],
  },
  {
    category: "financial_control",
    patterns: [
      /(?:월급|통장|카드|현금)(?:을|를)?(?:빼앗|뺏었|압수)/,
      /(?:생활비|돈)을?(?:끊었|안주겠다고|전혀못쓰게)/,
      /경제권을?(?:강제로|억지로)?(?:빼앗|통제)/,
      /내돈을?(?:허락없이|몰래)(?:가져갔|인출|빼갔)/,
      /(?:계좌|카드)비밀번호를?(?:강요|내놓으라고)/,
    ],
  },
  {
    category: "harm_to_others",
    patterns: [
      /(?:아이|아기|부모|가족|친구|반려동물)(?:을|를)?(?:죽이|해치|때리)(?:겠|려고|고싶)/,
      /누군가(?:을|를)?(?:죽이|해치)(?:겠|려고|고싶)/,
      /사람(?:을|를)?(?:죽이|해치)(?:겠|려고|고싶)/,
      MURDER_SUICIDE_THREAT_PATTERN,
    ],
  },
];

const SENSITIVE_PATTERNS = [
  /욕설(?:을)?(?:했|하|들었)/,
  /모욕(?:했|당했)/,
  /고함(?:을)?(?:질렀|쳤)/,
  /심한말(?:을)?(?:했|들었)/,
  /반복해서(?:비하|무시)/,
] as const;

function compactCourtText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function statementsToText(statements: readonly CourtStatementInput[]): string {
  return statements.flatMap((statement) => [
    statement.facts,
    statement.feelings ?? "",
    statement.expectations ?? "",
    statement.priorAgreement ?? "",
    statement.attempts ?? "",
    statement.desiredOutcome ?? "",
    statement.changeCommitment ?? "",
    ...(statement.evidenceSummaries ?? []),
  ]).join("\n");
}

/**
 * Conservative pre-provider gate. It returns categories only, never matched text,
 * so callers can persist the result without copying a sensitive statement.
 */
export function assessCourtSafety(
  input: string | readonly CourtStatementInput[],
): CourtSafetyAssessment {
  const compact = compactCourtText(
    typeof input === "string" ? input : statementsToText(input),
  );
  const categories = HIGH_RISK_PATTERNS
    .filter(({ patterns }) => patterns.some((pattern) => pattern.test(compact)))
    .map(({ category }) => category);

  if (categories.length > 0) {
    const selfHarm = categories.includes("self_harm");
    return {
      level: "high_risk",
      categories,
      resourceMessage: selfHarm
        ? COURT_SELF_HARM_SAFETY_MESSAGE
        : COURT_VIOLENCE_SAFETY_MESSAGE,
    };
  }

  const sensitive = SENSITIVE_PATTERNS.some((pattern) => pattern.test(compact));
  return {
    level: sensitive ? "sensitive" : "normal",
    categories: [],
  };
}
