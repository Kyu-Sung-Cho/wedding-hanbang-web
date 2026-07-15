/**
 * Conservative pre-provider guard for clear Korean relationship-violence
 * signals. It intentionally covers only high-confidence phrases; ordinary
 * disagreement and ambiguous wording continue through the normal safety
 * prompt. Never log or return the matched source phrase.
 */

const NEGATED_VIOLENCE_EXPRESSIONS = [
  /(?:때린|맞은|폭행당한|성폭행당한|성추행당한|감금된|협박받은|스토킹당한)\s*(?:건|것은|적은|적이)?\s*(?:아니|없)/gu,
  /(?:때리|폭행하|감금하|협박하|스토킹하)지\s*않(?:아|았|습니다|아요)/gu,
  /(?:폭행|성폭행|성추행|감금|협박|스토킹)(?:을|를)?\s*당한\s*적(?:은|이)?\s*없/gu,
  /(?:칼|흉기)(?:로|를)?\s*위협(?:한|받은)\s*(?:건|적은|적이)?\s*(?:아니|없)/gu,
];

const FICTION_OR_REPORTING_CONTEXT =
  /영화|드라마|소설|웹툰|기사|뉴스|보도|사건\s*요약|대사|장면|작품|줄거리/u;
const FIRST_PERSON_CONTEXT =
  /(?:^|\s)(?:나는|내가|나를|나에게|나한테|내\s|저는|제가|저를|저에게|저한테|제\s)/u;

const CLEAR_RELATIONSHIP_VIOLENCE_EXPRESSIONS = [
  /(?:남자친구|여자친구|남편|아내|예비\s*(?:신랑|신부)|신랑|신부|애인|연인|파트너|상대(?:방)?|그\s*사람)(?:이|가|은|는)?[\s\S]{0,30}(?:나|저|내|제)(?:를|한테|에게|\s*목)?[\s\S]{0,20}(?:때리|폭행|목(?:을)?\s*조르|감금|못\s*나가게|성폭행|성추행|강간|스토킹|위치[\s\S]{0,8}추적)/u,
  /(?:남자친구|여자친구|남편|아내|예비\s*(?:신랑|신부)|신랑|신부|애인|연인|파트너|상대(?:방)?|그\s*사람)(?:이|가|은|는)?[\s\S]{0,25}(?:칼|흉기)[\s\S]{0,15}(?:들고|위협|휘두르)/u,
  /(?:나|저|내|제)(?:를|한테|에게|\s*목)?[\s\S]{0,20}(?:때리|폭행|목(?:을)?\s*조르|감금|못\s*나가게|성폭행|성추행|강간|스토킹|위치[\s\S]{0,8}추적)/u,
  /(?:성폭행|성추행|강간)(?:을|를)?\s*당했/u,
  /(?:목(?:을)?\s*졸랐|목(?:을)?\s*졸렸|죽이겠다고\s*(?:협박|위협)|칼(?:로|을)?[\s\S]{0,10}(?:위협|들고))/u,
  /문(?:을)?[\s\S]{0,10}잠그[\s\S]{0,20}(?:나|저)[\s\S]{0,10}못\s*나가/u,
  /계속[\s\S]{0,15}위치(?:를)?\s*추적[\s\S]{0,25}집\s*앞[\s\S]{0,15}기다/u,
  /맞았[\s\S]{0,20}(?:같은\s*집|상대|남자친구|여자친구|남편|아내)/u,
];

function normalizeForDetection(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/[_*~`#>|/\\()[\]{}:;\-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function hasImmediateKoreanRelationshipViolenceSignal(userText: string): boolean {
  if (typeof userText !== "string" || userText.length === 0) return false;

  let candidate = normalizeForDetection(userText);
  for (const pattern of NEGATED_VIOLENCE_EXPRESSIONS) {
    candidate = candidate.replace(pattern, " ");
  }
  candidate = candidate.replace(/\s+/gu, " ").trim();
  if (!candidate) return false;

  if (FICTION_OR_REPORTING_CONTEXT.test(candidate) && !FIRST_PERSON_CONTEXT.test(candidate)) {
    return false;
  }

  return CLEAR_RELATIONSHIP_VIOLENCE_EXPRESSIONS.some((pattern) => pattern.test(candidate));
}

/**
 * Re-verified 2026-07-14 against official Korean help routes:
 * - Police 112: https://www.police.go.kr/www/agency/intro/intro0602.jsp
 * - National Fire Agency 119: https://nfa.go.kr/nfa/safetyinfo/emergencyservice/119emergencydeclaration
 * - Ministry of Gender Equality and Family 1366:
 *   https://www.mogef.go.kr/cc/wcc/cc_wcc_f001.do
 */
export const KOREAN_RELATIONSHIP_VIOLENCE_SAFETY_RESPONSE = `지금 말한 폭력·감금·위협은 단순한 의견 차이로 중재할 일이 아닙니다. 폭력은 피해자의 책임이 아닙니다. 아모라와 웨딩한방은 신고·구조·법률 자문을 대신할 수 없습니다.

본인이나 가까운 사람이 지금 위험하거나 다쳤다면:
- 가능하면 상대와 거리를 두고 주변 사람이나 공공장소처럼 더 안전한 곳으로 이동해 주세요.
- 범죄·폭력의 즉각적인 위험은 112, 부상이나 응급상황은 119에 연락해 주세요.
- 말로 신고하기 어렵다면 112 문자신고나 공식 112 긴급신고 앱도 이용할 수 있습니다.

지금 당장의 위험은 아니어도 가정폭력·성폭력·스토킹·교제폭력과 관련된 여성폭력 피해자는 1366에서 365일 24시간 상담과 보호 연계를 받을 수 있습니다. 성별과 관계없이 즉각적인 폭력 위험은 112에 도움을 요청할 수 있습니다.

가능하면 지금 **“당장 위험해요”** 또는 **“지금은 안전해요”** 중 하나로 답해 주세요.`;
