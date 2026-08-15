export type AmoraDecisionDepthMode = "focused" | "comprehensive";

export type AmoraDecisionDepthTopic = "family_meeting" | "wedding_decision";

export type AmoraDecisionDepthClassification = Readonly<{
  mode: AmoraDecisionDepthMode;
  topic: AmoraDecisionDepthTopic;
}>;

const FAMILY_MEETING_PATTERN =
  /상견례|양가\s*(?:부모님|가족|어른)?\s*(?:첫\s*)?(?:만남|인사)/u;
const WEDDING_DECISION_TOPIC_PATTERN =
  /결혼|웨딩|예식|식장|웨딩홀|스튜디오|사진\s*촬영|드레스|메이크업|스드메|예복|한복|예물|예단|결혼반지|청첩장|혼주|하객|축가|사회자|주례|신혼집|신혼여행|가전|가구|부케|스냅|DVD|답례|폐백/iu;
const DECISION_SEEKING_PATTERN =
  /어떻게|뭐|무엇|몇\s*(?:개|군데|명)|누가|언제|어디|준비|확인|비교|고르|선택|정하|알려|좋을까|해야|체크|주의|놓치|빠뜨|고민|궁금/u;
const COMPREHENSIVE_REQUEST_PATTERN =
  /처음|전부|전체|빠짐없이|놓치(?:는|기|지)|빠뜨리|뭐부터|무엇부터|어떻게\s*준비|준비(?:할|해야|하는)\s*(?:것|거)|체크\s*리스트|다\s*알려/u;
const LISTEN_ONLY_PATTERN =
  /(?:해결책|조언|정리|체크\s*리스트)(?:은|는)?\s*(?:말고|필요\s*없|하지\s*마)|그냥[^.!?\n]{0,24}(?:들어|얘기만)/u;
const DIRECT_STATE_COMMAND_PATTERN =
  /(?:저장|반영|추가|등록|수정|삭제|취소|완료\s*처리|바꿔)\s*(?:해|해줘|해주세요|할래|하자)/u;

export function classifyAmoraDecisionDepth(
  userText: string,
): AmoraDecisionDepthClassification | null {
  const normalized = userText.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  if (
    LISTEN_ONLY_PATTERN.test(normalized)
    || DIRECT_STATE_COMMAND_PATTERN.test(normalized)
  ) {
    return null;
  }

  const isDecisionSeeking =
    DECISION_SEEKING_PATTERN.test(normalized)
    || COMPREHENSIVE_REQUEST_PATTERN.test(normalized);
  const topic: AmoraDecisionDepthTopic | null = FAMILY_MEETING_PATTERN.test(normalized)
    && isDecisionSeeking
    ? "family_meeting"
    : WEDDING_DECISION_TOPIC_PATTERN.test(normalized)
      && isDecisionSeeking
      ? "wedding_decision"
      : null;
  if (!topic) return null;

  return {
    mode: COMPREHENSIVE_REQUEST_PATTERN.test(normalized)
      ? "comprehensive"
      : "focused",
    topic,
  };
}

export function buildAmoraDecisionDepthInstruction(
  classification: AmoraDecisionDepthClassification | null,
): string {
  if (!classification) return "";

  const responseMode = classification.mode === "comprehensive"
    ? "- 사용자가 전체 준비를 요청했습니다. 아래 렌즈를 내부적으로 모두 검토하되, 현재 상황에 실제로 관련 있는 항목만 우선순위대로 보여주세요. 목록 수를 채우려고 일반론을 늘리지 마세요."
    : "- 사용자가 한 가지를 물었습니다. 그 질문에 먼저 직접 답한 뒤, 답을 실제로 바꿀 사각지대만 1~2개 덧붙이세요. 전체 체크리스트로 넓히지 마세요.";
  const topicLens = classification.topic === "family_meeting"
    ? "- 먼저 원하는 결과와 현재 정해진 것·아직 모르는 것을 나누고, 참석자·이동·식사 제약, 민감한 대화와 가족별 기대, 비용·선물·결제, 변경·불참·취소 같은 예외, 끝난 뒤 남길 결정과 다음 행동을 내부적으로 점검하세요."
    : "- 먼저 원하는 결과와 현재 정해진 것·아직 모르는 것을 나누고, 일정·비용·계약·사람·실행·예외 중 이번 결정의 결과를 실제로 바꾸는 요소만 내부적으로 점검하세요.";
  const conventionBoundary = classification.topic === "family_meeting"
    ? "- 가족 형태·성별 역할·지역 관습을 전제하지 마세요. 관습은 의무가 아니라 선택지로 낮춰 말하고, 확인되지 않은 가격·시기·비율·관행은 만들지 마세요."
    : "- 확인되지 않은 가격·시기·비율·관행을 만들지 마세요. 업계 관행은 계약이나 현재 커플의 선택을 대신하는 정답이 아닙니다.";

  return [
    "[서버 확정 결혼 결정 깊이 계약]",
    `- decision_depth: ${classification.mode}`,
    `- decision_topic: ${classification.topic}`,
    responseMode,
    "- 저장된 현재 상황에서 이미 끝났거나 확인된 내용은 반복하지 마세요. 현재 발화와 저장 기록이 다르면 현재 발화를 우선하되, 충돌을 사실처럼 숨기지 마세요.",
    "- 사용자가 직접 고른 답변 방식은 보여주는 순서와 분량에 적용하세요. 개인 기준과 두 사람의 기준은 이번 선택이 실제로 갈릴 때만 근거로 쓰고, 설정 이름이나 내부 라벨을 노출하지 마세요. 개인화 정보가 없으면 아는 척하지 마세요.",
    topicLens,
    conventionBoundary,
    "- 답을 크게 바꾸는 정보가 없을 때만 확인 질문을 하나 하세요. 답할 수 있는 부분까지 질문으로 미루지 마세요.",
  ].join("\n");
}
