// 웨딩코드 v0.3 스모크 폼 콘텐츠 — 출처: docs/wedding-code/15_no_code_form_v0.3_build_pack.md
// 이 파일은 "수집용 프로토타입"이다. 채점·가중치·공개 코드·유형·캐릭터·궁합 표현 금지
// (가드레일 결정 기록: docs/wedding-code/16_inapp_prototype_decision_v1.md).
// 문구를 바꿀 때는 15번 빌드팩과 함께 바꿔서 드리프트를 막는다.

export const WEDDING_CODE_FORM_VERSION = "v0.3";

export const WC_INTRO_TITLE = "웨딩코드 3분 테스트 — 프로토타입";

export const WC_INTRO_BODY = `이 테스트는 웨딩코드 질문을 다듬기 위한 프로토타입입니다.

결혼 준비를 하다 보면 예산, 견적, 분위기, 가족 조율, 상대와의 역할 분담처럼 여러 기준을 함께 보게 됩니다. 이 테스트는 실제 결혼 준비 상황형 질문을 통해 어떤 질문이 이해하기 쉽고 공감되는지, 그리고 어떤 제품 방향이 도움이 될지 확인하기 위한 3분짜리 테스트입니다.

이 테스트는 심리 진단, 관계 상담, 법률 자문, 결혼 성공 예측, 이혼 예측이 아닙니다.

이번 테스트에서는 최종 유형, 점수, 캐릭터, 4글자 코드가 부여되지 않습니다. 답변은 문항 품질과 제품 방향을 개선하는 데 사용됩니다.`;

export const WC_NO_RIGHT_ANSWER = "정답은 없습니다. 가장 가까운 반응을 골라주세요.";

export const WC_CONSENT_LABEL = "위 내용을 확인했고, 테스트 목적의 응답 수집에 동의합니다.";

export const WC_HYPOTHETICAL_NOTE =
  "아직 해당 상황을 겪지 않았다면, 그런 상황이라고 가정하고 가장 가까운 반응을 골라주세요.";

export const WC_OPTIONAL_SECTION_TITLE = "아직 겪지 않았을 수 있는 결혼 준비 상황";

export const WC_THANK_YOU = `참여해주셔서 감사합니다.

이번 테스트는 최종 결과를 제공하는 검사가 아니라, 웨딩코드 문항이 실제 결혼 준비 상황처럼 느껴지는지 확인하기 위한 프로토타입입니다.

남겨주신 답변은 문항을 더 명확하고 안전하게 다듬고, 앞으로 어떤 제품 지원이 도움이 될지 판단하는 데 사용됩니다.`;

// ── 참여자 컨텍스트 ──────────────────────────────────────────

export const WC_STAGES = [
  { value: "dating_or_meeting", label: "연애 중 (결혼 얘기 전)" },
  { value: "marriage_discussion", label: "결혼 얘기를 하는 중" },
  { value: "preparing_without_date", label: "날짜는 미정, 준비 시작" },
  { value: "venue_search", label: "예식장 알아보는 중" },
  { value: "sdm_search", label: "스드메 알아보는 중" },
  { value: "contract_pending", label: "계약 결정 직전" },
  { value: "contracted", label: "계약 완료" },
  { value: "wedding_week", label: "본식 주간" },
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
  { value: "received", label: "견적을 받음" },
  { value: "contracted", label: "계약함" },
] as const;

export const WC_PARENT_INVOLVEMENTS = [
  { value: "low", label: "낮음" },
  { value: "medium", label: "보통" },
  { value: "high", label: "높음" },
  { value: "unknown", label: "아직 모르겠음" },
] as const;

export const WC_CONCERNS = [
  "예산·견적",
  "예식장",
  "스드메",
  "가족 조율",
  "상대와 역할 분담",
  "일정 관리",
  "정보가 너무 많음",
  "아직 잘 모름",
  "기타",
] as const;

// ── 16문항 (v0.3 확정 카피) ─────────────────────────────────

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
    question:
      "스튜디오 패키지가 좋아 보이지만 원본, 보정, 헬퍼, 얼리스타트 비용이 분명하지 않습니다. 가장 먼저 할 일은 무엇인가요?",
    options: [
      { value: "A", label: "포함·불포함 항목과 추가 비용을 항목별로 먼저 확인한다." },
      { value: "B", label: "포트폴리오와 촬영 결과가 우리가 원하는 분위기와 맞는지 더 본다." },
      { value: "C", label: "상대와 촬영에서 꼭 필요한 항목과 조정 가능한 항목을 나눈다." },
      { value: "D", label: "비슷한 구성을 이용한 실제 후기나 사례를 더 확인한다." },
    ],
  },
  {
    key: "q02", id: "WC-Q-experienceMeaning-001", construct: "experienceMeaning", required: true,
    question:
      "본식 의상이나 촬영 스타일 중 하나가 오래 기억에 남을 것 같지만 추가 비용이 있습니다. 무엇을 먼저 생각하나요?",
    options: [
      { value: "A", label: "이 선택이 시간이 지나도 우리에게 의미 있게 남을지 먼저 생각한다." },
      { value: "B", label: "추가 비용이 전체 예산 안에서 감당 가능한지 먼저 계산한다." },
      { value: "C", label: "비슷한 느낌을 주는 다른 의상이나 촬영 스타일도 함께 찾아본다." },
      { value: "D", label: "상대와 어떤 장면을 오래 남기고 싶은지 먼저 이야기한다." },
    ],
  },
  {
    key: "q03", id: "WC-Q-coPreparation-003", construct: "coPreparation", required: true,
    question:
      "상담 후 마음에 드는 업체가 생겼지만 상대는 아직 자세히 보지 못했습니다. 무엇이 먼저 필요하다고 느끼나요?",
    options: [
      { value: "A", label: "상대가 직접 볼 수 있도록 상담 내용과 후보 자료를 함께 펼쳐 확인한다." },
      { value: "B", label: "내가 상담 핵심과 판단 기준을 한 장으로 요약한 뒤 최종 확인만 같이 한다." },
      { value: "C", label: "계약 전에 둘 다 확인할 견적·조건·후기 체크 항목부터 만든다." },
      { value: "D", label: "왜 마음에 들었는지 분위기와 기억 포인트를 먼저 설명하고 반응을 들어본다." },
    ],
  },
  {
    key: "q04", id: "WC-Q-roleOwnership-006", construct: "roleOwnership", required: true,
    question:
      "한 사람이 업체 후보를 먼저 알아봤고, 계약 전에는 둘 다 최종 확인하려고 합니다. 어떤 방식으로 확인하는 게 가장 필요할까요?",
    options: [
      { value: "A", label: "알아본 사람이 후보별 선택 이유와 남은 확인점을 요약하고 둘이 승인한다." },
      { value: "B", label: "둘이 계약서, 견적, 후기, 포트폴리오를 처음부터 끝까지 같이 본다." },
      { value: "C", label: "최종 확인은 계약서와 견적 조건처럼 되돌리기 어려운 항목에 집중한다." },
      { value: "D", label: "한 사람은 조건·일정, 한 사람은 무드·만족도 체크리스트를 맡아 확인한다." },
    ],
  },
  {
    key: "q05", id: "WC-Q-evidenceDecision-006", construct: "evidenceDecision", required: true,
    question:
      "상담 중 서비스 추가를 약속받았지만 계약서에는 아직 없습니다. 다음 행동으로 가장 가까운 것은 무엇인가요?",
    options: [
      { value: "A", label: "약속받은 서비스 이름과 조건을 계약서나 메시지로 남겨달라고 요청한다." },
      { value: "B", label: "추가 서비스가 실제로 우리에게 필요한 혜택인지 따져본다." },
      { value: "C", label: "그 약속이 없어도 이 업체가 우리 기준에 맞는지 다시 본다." },
      { value: "D", label: "문서 확인 후 다시 결정할 시간을 잡고 계약 일정은 잠시 늦춘다." },
    ],
  },
  {
    key: "q06", id: "WC-Q-aestheticMood-002", construct: "aestheticMood", required: true,
    question:
      "투어 중 한 홀에 들어갔을 때 분위기가 우리와 잘 맞는다고 느꼈습니다. 무엇을 먼저 확인하고 싶나요?",
    options: [
      { value: "A", label: "현장에서 느낀 색감, 공간감, 전체 톤이 우리가 원한 분위기와 맞는지 정리한다." },
      { value: "B", label: "식대, 보증 인원, 교통처럼 가족과 하객에게 영향을 주는 조건을 확인한다." },
      { value: "C", label: "사진과 영상에 남을 조명, 동선, 촬영 각도를 확인한다." },
      { value: "D", label: "상대가 중요하게 보는 기준과 가족이 볼 기준을 따로 적어 맞춰본다." },
    ],
  },
  {
    key: "q07", id: "WC-Q-familyIntegration-002", construct: "familyIntegration", required: true,
    question:
      "우리는 분위기가 좋은 예식장이 끌리지만 부모님은 음식과 교통을 더 중요하게 봅니다. 무엇을 먼저 해보고 싶나요?",
    options: [
      { value: "A", label: "부모님이 걱정하는 음식과 교통 기준을 먼저 구체적으로 들어본다." },
      { value: "B", label: "분위기와 하객 편의를 함께 비교할 수 있는 표를 만든다." },
      { value: "C", label: "예산과 보증 인원까지 포함해 현실적인 차이를 확인한다." },
      { value: "D", label: "우리 기준을 정리한 뒤 부모님께 설명할 절충안을 준비한다." },
    ],
  },
  {
    key: "q08", id: "WC-Q-coupleAutonomy-004", construct: "coupleAutonomy", required: true,
    question:
      "부모님께 우리 결혼식의 예산·하객수·진행 방식 기준을 설명해야 합니다. 가장 먼저 준비할 것은 무엇인가요?",
    options: [
      { value: "A", label: "둘이 먼저 예산, 하객수, 진행 방식의 기준을 맞춘다." },
      { value: "B", label: "부모님께 보여드릴 예산 범위, 하객수 기준, 진행 이유를 숫자로 정리한다." },
      { value: "C", label: "부모님이 걱정할 지점을 예상하고 어떤 순서로 들을지 정한다." },
      { value: "D", label: "우리 기준을 처음 꺼낼 때 쓸 부드러운 첫 문장을 만들어본다." },
    ],
  },
  {
    key: "q09", id: "WC-Q-emotionalSupport-002", construct: "emotionalSupport", required: true,
    question:
      "상담 후 걱정된다고 말했더니 상대가 바로 해결책을 제안했습니다. 그 순간 가장 가까운 느낌은 무엇인가요?",
    options: [
      { value: "A", label: "해결책 전에 왜 걱정되는지 먼저 들어주면 좋겠다고 느낀다." },
      { value: "B", label: "걱정된다는 말을 짧게 확인받은 뒤 선택지를 같이 정리하면 도움이 될 것 같다." },
      { value: "C", label: "바로 다음 행동을 정리해주는 것도 괜찮다고 느낀다." },
      { value: "D", label: "이런 상황에서 어떤 반응이 나에게 맞는지 상대와 이야기하고 싶다." },
    ],
  },
  {
    key: "q10", id: "WC-Q-executionSupport-006", construct: "executionSupport", required: true,
    gateFlag: "q_execution_stage_flag",
    question:
      "본식이 가까워져 업체 연락, 가족 안내, 준비물 확인이 한꺼번에 남았다고 가정하면, 가장 먼저 하고 싶은 것은 무엇인가요?",
    options: [
      { value: "A", label: "남은 일을 누가 맡을지 먼저 나눈다." },
      { value: "B", label: "오늘, 내일, 본식 당일 순서로 마감이 가까운 일부터 정렬한다." },
      { value: "C", label: "가족과 업체에 보낼 안내 문장을 먼저 정리한다." },
      { value: "D", label: "서로 부담되는 부분을 이야기한 뒤 일을 나눈다." },
    ],
  },
  {
    key: "q11", id: "WC-Q-decisionPaceRisk-004", construct: "decisionPaceRisk", required: true,
    question:
      "상담을 다녀온 직후 매우 마음에 들어 바로 정하고 싶은 기분이 듭니다. 무엇이 가장 도움이 될까요?",
    options: [
      { value: "A", label: "하루 정도 시간을 두고도 같은 마음인지 다시 확인한다." },
      { value: "B", label: "마음에 든 이유와 걱정되는 점을 상대와 같이 적어본다." },
      { value: "C", label: "계약서, 총액, 취소 조건을 확인한 뒤 결정한다." },
      { value: "D", label: "다른 후보와 분위기와 조건을 한 번 더 비교한다." },
    ],
  },
  {
    key: "q12", id: "WC-Q-guidanceNeed-005", construct: "guidanceNeed", required: true,
    gateFlag: "q_guidance_stage_flag",
    question:
      "견적서를 받았다고 가정하면, 항목명이 낯설고 여러 장으로 나뉘어 있을 때 가장 도움이 되는 것은 무엇인가요?",
    options: [
      { value: "A", label: "가장 먼저 확인할 3가지와 질문 순서만 추려주면 좋겠다." },
      { value: "B", label: "내가 직접 비교할 수 있게 항목별 표로 정리해주면 좋겠다." },
      { value: "C", label: "추가금 가능성이 큰 항목을 눈에 띄게 표시해주면 좋겠다." },
      { value: "D", label: "상대와 이야기할 질문 목록으로 바꿔주면 좋겠다." },
    ],
  },
  {
    key: "q13", id: "WC-Q-costRisk-001", construct: "costRisk", required: false,
    gateFlag: "q_cost_boundary_flag",
    question:
      "마음에 드는 예식장이 예상보다 300만 원 비쌉니다. 상담 직후 가장 먼저 확인하고 싶은 것은 무엇인가요?",
    options: [
      { value: "A", label: "총액, 추가금, 환불 조건을 먼저 확인한다." },
      { value: "B", label: "이 장소가 우리에게 오래 남을 경험인지 먼저 생각한다." },
      { value: "C", label: "부모님과 하객의 이동, 식사, 동선을 함께 고려한다." },
      { value: "D", label: "상대와 예산과 만족감 기준을 다시 맞춘다." },
    ],
  },
  {
    key: "q14", id: "WC-Q-roleOwnership-003", construct: "roleOwnership", required: false,
    question:
      "한 사람은 스타일 비교를 잘하고, 다른 한 사람은 조건 비교를 잘합니다. 준비 방식으로 가장 가까운 것은 무엇인가요?",
    options: [
      { value: "A", label: "각자 잘 보는 기준을 맡고 결과를 서로 공유한다." },
      { value: "B", label: "중요한 후보는 스타일과 조건 모두 둘이 같이 확인한다." },
      { value: "C", label: "한 사람이 후보를 2~3개로 줄이고, 줄인 이유를 공유한 뒤 마지막은 함께 정한다." },
      { value: "D", label: "각자 본 기준을 점수 없이 한 비교표에 합쳐 같이 본다." },
    ],
  },
  {
    key: "q15", id: "WC-Q-evidenceDecision-001", construct: "evidenceDecision", required: false,
    question:
      "포트폴리오는 마음에 들지만 실제 이용 후기가 많지 않은 스튜디오가 있습니다. 무엇을 먼저 확인하나요?",
    options: [
      { value: "A", label: "이 스튜디오의 실제 이용 사례, 후기, 포함 조건을 더 확인한다." },
      { value: "B", label: "포트폴리오가 원하는 무드와 얼마나 맞는지 다시 본다." },
      { value: "C", label: "비슷한 무드이면서 후기가 더 많은 다른 후보를 1~2곳 더 찾아본다." },
      { value: "D", label: "상대와 어느 정도의 정보 부족까지 괜찮은지 이야기한다." },
    ],
  },
  {
    key: "q16", id: "WC-Q-coupleAutonomy-002", construct: "coupleAutonomy", required: false,
    gateFlag: "q_autonomy_boundary_flag",
    question:
      "일부 전통 절차를 간소화하고 싶지만 가족이 어떻게 받아들일지 걱정됩니다. 무엇을 먼저 해보고 싶나요?",
    options: [
      { value: "A", label: "왜 간소화하고 싶은지 둘의 기준과 의미를 먼저 정리한다." },
      { value: "B", label: "가족이 걱정할 지점을 예상하고 설명 방식을 준비한다." },
      { value: "C", label: "예절을 지키면서 줄일 수 있는 절차를 구분한다." },
      { value: "D", label: "예산, 시간, 진행 흐름에 어떤 도움이 되는지 자료로 정리한다." },
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
  { key: "quote_check_interest", label: "받은 견적이나 계약 조건을 이 답변 기준으로 확인해보고 싶다" },
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
