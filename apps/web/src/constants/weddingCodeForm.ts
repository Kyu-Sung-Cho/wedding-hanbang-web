// 웨딩코드 폼 공통 카피와 참여자 컨텍스트 옵션.
// 실제 v0.5 문항·채점 버전은 weddingCodeV05.ts가 관리한다.
// 공개 결과는 준비 방식 참고 카드이며, 최종 유형·캐릭터·4글자 코드·관계 판정으로 표현하지 않는다.

export const WEDDING_CODE_FORM_VERSION = "v0.5-candidate.9";

export const WC_INTRO_TITLE = "웨딩코드 3분 테스트";

export const WC_INTRO_BODY = `웨딩코드는 결혼 준비 대화를 더 쉽게 시작하기 위한 상황형 테스트입니다.

결혼 준비를 하다 보면 예산, 비용표, 장소, 가족 조율, 상대와의 역할 분담을 함께 봐야 합니다. 이 테스트는 실제 결혼 준비 상황에서 내가 중요하게 보는 것을 정리해봅니다.

결과는 사람을 평가하거나 두 사람의 앞날을 단정하기 위한 자료가 아닙니다.

결과 화면에서는 답변을 바탕으로 준비 방식 축과 대화 카드를 보여줄 수 있습니다. 최종 유형, 캐릭터, 4글자 코드, 두 사람의 관계 판정은 제공하지 않습니다.`;

export const WC_NO_RIGHT_ANSWER =
  "정답은 없습니다. 여러 선택지가 다 맞을 수 있어요. 그중 지금 가장 먼저 떠오르는 반응 하나를 골라주세요.";

export const WC_CONSENT_LABEL = "위 내용을 확인했고, 테스트 목적의 응답 수집에 동의합니다.";

export const WC_HYPOTHETICAL_NOTE =
  "아직 겪지 않은 상황일 수 있어요. 그런 상황이라고 상상하고 가장 가까운 반응을 골라주세요.";

export const WC_OPTIONAL_SECTION_TITLE = "아직 겪지 않았을 수 있는 상황";

export const WC_THANK_YOU = `참여해주셔서 감사합니다.

웨딩코드는 결혼 준비 상황을 더 편하게 이야기하기 위한 참고 도구입니다.

남겨주신 답변은 결과 카드 생성과 문항 품질 개선에 사용됩니다.`;

// ── 참여자 컨텍스트 ──────────────────────────────────────────

export const WC_STAGES = [
  { value: "dating_or_meeting", label: "연애 중 (결혼 얘기 전)" },
  { value: "marriage_discussion", label: "결혼 얘기를 하는 중" },
  { value: "preparing_without_date", label: "날짜는 미정, 준비 시작" },
  { value: "venue_search", label: "결혼식장 알아보는 중" },
  { value: "sdm_search", label: "사진·드레스·메이크업 알아보는 중" },
  { value: "contract_pending", label: "예약 확정 직전" },
  { value: "contracted", label: "예약 확정 완료" },
  { value: "wedding_week", label: "결혼식이 있는 주" },
  { value: "post_wedding", label: "결혼식 이후" },
] as const;

export const WC_ANSWERING_MODES = [
  { value: "alone", label: "혼자" },
  { value: "with_partner", label: "상대와 함께" },
  { value: "sometimes_together", label: "상황에 따라 같이 이야기함" },
  { value: "not_applicable", label: "해당 없음" },
] as const;

export const WC_QUOTE_STATUSES = [
  { value: "none", label: "아직 없음" },
  { value: "consulted", label: "상담만 해봄" },
  { value: "received", label: "비용표를 받음" },
  { value: "contracted", label: "예약 확정함" },
] as const;

export const WC_PARENT_INVOLVEMENTS = [
  { value: "low", label: "낮음" },
  { value: "medium", label: "보통" },
  { value: "high", label: "높음" },
  { value: "unknown", label: "아직 모르겠음" },
] as const;

export const WC_CONCERNS = [
  "예산·비용",
  "결혼식장",
  "사진·드레스·메이크업",
  "가족 조율",
  "상대와 역할 분담",
  "일정 관리",
  "정보가 너무 많음",
  "아직 잘 모름",
  "기타",
] as const;

// ── 레거시 공유카드 테스트 fixture ─────────────────────────
// 실제 v0.5 화면 문항은 weddingCodeV05.ts의 WEDDING_CODE_V05_QUESTIONS가 관리한다.
// 아래 q01~q16 세트는 과거 공유 카드 레이아웃 테스트와 quote fixture 호환을 위해 남긴다.

export interface WcQuestion {
  /** 내보내기 컬럼명 q01~q16 */
  key: string;
  id: string;
  construct: string;
  required: boolean;
  /** 단계 게이팅 플래그 컬럼명 (15번 §8) — 없으면 게이팅 없음 */
  gateFlag?: "q_execution_stage_flag" | "q_guidance_stage_flag" | "q_autonomy_boundary_flag" | "q_cost_boundary_flag";
  question: string;
  options: { value: "A" | "B" | "C" | "D"; label: string }[];
}

export const WC_QUESTIONS: WcQuestion[] = [
  {
    key: "q01", id: "WC-Q-costRisk-005", construct: "costRisk", required: true,
    question: "사진 촬영, 드레스, 메이크업 비용표를 받았는데, 어디서 돈이 더 나올지 감이 안 와요. 이럴 때 나는 —",
    options: [
      { value: "A", label: "가격에 들어 있는 것과 추가로 돈 내야 하는 것을 먼저 본다" },
      { value: "B", label: "예시 사진과 드레스, 메이크업이 마음에 드는지부터 본다" },
      { value: "C", label: "둘이 필요한 것부터 고른다" },
      { value: "D", label: "이곳을 이용한 사람들의 후기를 찾아본다" },
    ],
  },
  {
    key: "q02", id: "WC-Q-experienceMeaning-001", construct: "experienceMeaning", required: true,
    question: "결혼식 영상을 찍거나 앨범을 더 만들면 돈이 더 든대요. 이럴 때 나는 —",
    options: [
      { value: "A", label: "나중에 다시 봤을 때 잘 선택했다고 느낄지 생각한다" },
      { value: "B", label: "추가로 내는 돈이 부담되지 않을지 계산한다" },
      { value: "C", label: "더 적은 돈으로 필요한 장면만 남길 방법을 찾아본다" },
      { value: "D", label: "둘 다 나중에 보고 싶어 할 장면인지 이야기한다" },
    ],
  },
  {
    key: "q03", id: "WC-Q-coPreparation-003", construct: "coPreparation", required: true,
    question: "마음에 드는 결혼 준비 업체나 결혼식장을 찾았는데, 상대는 아직 자세히 못 봤어요. 이럴 때 나는 —",
    options: [
      { value: "A", label: "같이 볼 시간을 먼저 잡는다" },
      { value: "B", label: "좋았던 점과 아쉬운 점만 짧게 정리해 보낸다" },
      { value: "C", label: "가격, 위치, 사진처럼 같이 확인할 항목을 정한다" },
      { value: "D", label: "왜 마음에 들었는지 말하고 상대 생각을 듣는다" },
    ],
  },
  {
    key: "q04", id: "WC-Q-roleOwnership-006", construct: "roleOwnership", required: true,
    question: "한 명이 주로 알아보고, 결정 전에 둘이 최종 확인하기로 했어요. 이럴 때 우리는 —",
    options: [
      { value: "A", label: "알아본 사람이 요약하고, 같이 확인한다" },
      { value: "B", label: "중요한 건 처음부터 끝까지 둘이 같이 본다" },
      { value: "C", label: "되돌리기 어려운 것(예약 확정·환불)만 집중해서 본다" },
      { value: "D", label: "한 명은 조건을, 다른 한 명은 마음에 드는 점을 나눠 본다" },
    ],
  },
  {
    key: "q05", id: "WC-Q-evidenceDecision-006", construct: "evidenceDecision", required: true,
    question: "상담에서 \"그건 그냥 해드릴게요\"라고 했는데, 예약 문서엔 그 내용이 없어요. 이럴 때 나는 —",
    options: [
      { value: "A", label: "문자로라도 남겨달라고 요청한다" },
      { value: "B", label: "그 혜택이 진짜 필요한 건지 따져본다" },
      { value: "C", label: "그 약속 없이도 괜찮은 곳인지 다시 본다" },
      { value: "D", label: "그 내용이 예약 문서에 적힌 걸 확인한 뒤에 예약한다" },
    ],
  },
  {
    key: "q06", id: "WC-Q-aestheticMood-002", construct: "aestheticMood", required: true,
    question: "결혼식장을 둘러보다가 마음에 드는 곳을 봤어요. 이럴 때 나는 —",
    options: [
      { value: "A", label: "우리가 좋아하는 장소인지 찬찬히 본다" },
      { value: "B", label: "식사 비용·인원·오는 길 같은 조건부터 확인한다" },
      { value: "C", label: "사진과 영상에 어떻게 남을지 본다" },
      { value: "D", label: "상대와 가족이 중요하게 볼 점도 확인한다" },
    ],
  },
  {
    key: "q07", id: "WC-Q-familyIntegration-002", construct: "familyIntegration", required: true,
    question: "우리는 결혼식장이 마음에 드는데, 부모님은 음식과 오는 길을 보세요. 이럴 때 나는 —",
    options: [
      { value: "A", label: "부모님 기준부터 구체적으로 들어본다" },
      { value: "B", label: "둘의 기준과 부모님 기준을 표 하나에 나란히 적는다" },
      { value: "C", label: "예산, 인원, 주차 같은 실제 조건부터 확인한다" },
      { value: "D", label: "장소는 유지하면서 바꿀 수 있는 점을 찾는다" },
    ],
  },
  {
    key: "q08", id: "WC-Q-coupleAutonomy-004", construct: "coupleAutonomy", required: true,
    question: "우리 결혼식 기준을 부모님께 말씀드려야 해요. 이럴 때 나는 —",
    options: [
      { value: "A", label: "그 전에 둘이 먼저 정해두고 싶은 것부터 맞춘다" },
      { value: "B", label: "예산과 이유를 숫자로 정리해 보여드린다" },
      { value: "C", label: "걱정하실 지점을 먼저 예상해본다" },
      { value: "D", label: "부드럽게 꺼낼 첫마디를 준비한다" },
    ],
  },
  {
    key: "q09", id: "WC-Q-emotionalSupport-002", construct: "emotionalSupport", required: true,
    question: "\"걱정된다\"고 했더니 상대가 바로 해결책부터 내놨어요. 이 순간 나는 —",
    options: [
      { value: "A", label: "일단 내 마음부터 들어줬으면 싶다" },
      { value: "B", label: "짧게 공감받고, 같이 정리하면 좋겠다" },
      { value: "C", label: "바로 정리해주는 것도 고맙다" },
      { value: "D", label: "'다음엔 이렇게 반응해줘'라고 미리 말해두고 싶다" },
    ],
  },
  {
    key: "q10", id: "WC-Q-executionSupport-006", construct: "executionSupport", required: true,
    gateFlag: "q_execution_stage_flag",
    question: "결혼식 직전, 연락할 곳과 챙길 게 한꺼번에 쏟아진다면 나는 먼저 —",
    options: [
      { value: "A", label: "누가 뭘 맡을지부터 나눈다" },
      { value: "B", label: "마감 순서대로 할 일을 줄 세운다" },
      { value: "C", label: "보낼 안내 문자부터 정리한다" },
      { value: "D", label: "서로 부담부터 얘기하고 일을 나눈다" },
    ],
  },
  {
    key: "q11", id: "WC-Q-decisionPaceRisk-004", construct: "decisionPaceRisk", required: true,
    question: "상담이 너무 좋아서 오늘 바로 예약을 확정하고 싶어요. 이럴 때 나는 —",
    options: [
      { value: "A", label: "하루 자고 나서도 같은 마음인지 본다" },
      { value: "B", label: "좋았던 점과 걱정되는 점을 같이 적어본다" },
      { value: "C", label: "총금액과 취소 조건을 확인하고 정한다" },
      { value: "D", label: "다른 선택지와 한 번 더 비교해본다" },
    ],
  },
  {
    key: "q12", id: "WC-Q-guidanceNeed-005", construct: "guidanceNeed", required: true,
    gateFlag: "q_guidance_stage_flag",
    question: "비용표가 낯선 항목투성이라면, 나는 —",
    options: [
      { value: "A", label: "확인할 3가지만 콕 집어주면 좋겠다" },
      { value: "B", label: "직접 비교하게 표로 정리해주면 좋겠다" },
      { value: "C", label: "추가 비용이 붙기 쉬운 곳만 표시해주면 좋겠다" },
      { value: "D", label: "둘이 얘기할 질문 목록으로 바꿔주면 좋겠다" },
    ],
  },
  {
    key: "q13", id: "WC-Q-costRisk-001", construct: "costRisk", required: false,
    gateFlag: "q_cost_boundary_flag",
    question: "마음에 드는 결혼식장이 예산보다 300만 원 비싸요. 이럴 때 나는 —",
    options: [
      { value: "A", label: "총금액과 추가 비용, 환불 조건부터 확인한다" },
      { value: "B", label: "그만큼 오래 남을 곳인지 생각해본다" },
      { value: "C", label: "가족과 초대 손님이 오기 편한지도 같이 따져본다" },
      { value: "D", label: "둘의 예산 기준을 다시 맞춰본다" },
    ],
  },
  {
    key: "q14", id: "WC-Q-roleOwnership-003", construct: "roleOwnership", required: false,
    question: "한 명은 마음에 드는 점을 잘 보고, 다른 한 명은 조건을 잘 봐요. 우리라면 —",
    options: [
      { value: "A", label: "각자 확인할 부분을 맡고 결과를 공유한다" },
      { value: "B", label: "마지막으로 고를 곳은 둘 다 같이 본다" },
      { value: "C", label: "한 명이 2~3개만 추리고 마지막은 함께 정한다" },
      { value: "D", label: "각자 본 내용을 표 하나로 합쳐서 같이 본다" },
    ],
  },
  {
    key: "q15", id: "WC-Q-evidenceDecision-001", construct: "evidenceDecision", required: false,
    question: "예시 사진은 마음에 드는데, 실제 후기가 별로 없어요. 이럴 때 나는 —",
    options: [
      { value: "A", label: "최근에 실제로 찍은 사진을 더 찾아본다" },
      { value: "B", label: "예시 사진이 우리가 좋아하는 사진과 가까운지 본다" },
      { value: "C", label: "후기가 더 많은 다른 곳도 비교해본다" },
      { value: "D", label: "후기가 적어도 둘 다 선택할 마음이 있는지 이야기한다" },
    ],
  },
  {
    key: "q16", id: "WC-Q-coupleAutonomy-002", construct: "coupleAutonomy", required: false,
    gateFlag: "q_autonomy_boundary_flag",
    question: "결혼식 전후에 하는 전통 행사나 가족 선물을 간단히 하고 싶은데, 가족 반응이 걱정돼요. 이럴 때 나는 —",
    options: [
      { value: "A", label: "왜 간단히 하고 싶은지 둘의 이유부터 정리한다" },
      { value: "B", label: "걱정하실 부분과 설명 방법을 준비한다" },
      { value: "C", label: "어떤 건 그대로 하고, 어떤 건 간단히 바꿀지 나눠본다" },
      { value: "D", label: "시간과 비용이 어떻게 달라지는지 정리한다" },
    ],
  },
];

// ── 피드백 (1~5 척도) ───────────────────────────────────────

export const WC_SCALE_LABELS = ["전혀 아니다", "아니다", "보통이다", "그렇다", "매우 그렇다"] as const;

export const WC_FEEDBACK_ITEMS = [
  { key: "feels_like_me", label: "내 얘기처럼 느껴졌다" },
  { key: "scenario_realism", label: "실제 결혼 준비 상황처럼 느껴졌다" },
  { key: "clarity", label: "질문이 이해하기 쉬웠다" },
  { key: "stigma_feedback_score", label: "불편하거나 평가받는 느낌이 있었다" },
  { key: "confusing_question_score", label: "헷갈리는 질문이 있었다" },
] as const;

export const WC_CTA_ITEMS = [
  { key: "partner_invite_interest", label: "이 테스트를 상대에게 보내 같이 비교해보고 싶다" },
  { key: "couple_report_interest", label: "둘의 결혼 준비 방식이 어떻게 비슷하고 다른지 커플 리포트로 보고 싶다" },
  { key: "amora_interest", label: "이 답변을 바탕으로 아모라에게 다음 행동이나 대화 문장을 추천받고 싶다" },
  { key: "quote_check_interest", label: "받은 비용표나 예약 조건을 이 답변 기준으로 확인해보고 싶다" },
  { key: "etiquette_checklist_interest", label: "가족 조율, 예절, 준비 체크리스트를 이 답변 기준으로 받아보고 싶다" },
] as const;

export const WC_FREE_TEXT_ITEMS = [
  { key: "most_relatable_question", label: "가장 공감된 질문은 무엇인가요?" },
  { key: "most_awkward_question", label: "가장 어색하거나 불편했던 질문은 무엇인가요?" },
  { key: "desired_report", label: "어떤 결과 리포트를 받고 싶나요?" },
  { key: "free_text_feedback", label: "추가로 하고 싶은 말이 있다면 적어주세요." },
] as const;

// ── 단계 게이팅 (15번 §6 Option B) ──────────────────────────
// 반환: "direct"(해당 단계라 바로 노출) | "hypothetical"(가정 섹션으로)

export function gateQuestion(
  q: WcQuestion,
  ctx: { stage: string; quoteStatus: string; parentInvolvement: string }
): "direct" | "hypothetical" {
  switch (q.gateFlag) {
    case "q_execution_stage_flag":
      return ["contracted", "wedding_week", "post_wedding"].includes(ctx.stage) ? "direct" : "hypothetical";
    case "q_guidance_stage_flag":
      return ["consulted", "received", "contracted"].includes(ctx.quoteStatus) ? "direct" : "hypothetical";
    case "q_autonomy_boundary_flag":
      return ["medium", "high"].includes(ctx.parentInvolvement) ||
        ["marriage_discussion", "preparing_without_date", "contracted"].includes(ctx.stage)
        ? "direct"
        : "hypothetical";
    case "q_cost_boundary_flag":
      return ["venue_search", "contract_pending", "contracted"].includes(ctx.stage) ? "direct" : "hypothetical";
    default:
      return "direct";
  }
}
