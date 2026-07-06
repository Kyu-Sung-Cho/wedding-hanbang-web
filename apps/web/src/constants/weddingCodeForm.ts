// 웨딩코드 v0.4 스모크 폼 콘텐츠 — 카피 원본: docs/wedding-code/19_item_set_v0.4_rewrite.md
// (v0.3 → v0.4: 첫 내부 테스트 피드백 "너무 구체적·현실감 없음" 반영 — 감정 훅 + 단문
//  선택지로 표면 리라이트. 구성개념 매핑·선택지 성향 구조·낙인 방지 가드레일은 v0.3 유지.)
// 이 파일은 "수집용 프로토타입"이다. 채점·가중치·공개 코드·유형·캐릭터·궁합 표현 금지
// (가드레일 결정 기록: docs/wedding-code/16_inapp_prototype_decision_v1.md).

export const WEDDING_CODE_FORM_VERSION = "v0.4.1";

export const WC_INTRO_TITLE = "웨딩코드 3분 테스트 — 프로토타입";

export const WC_INTRO_BODY = `이 테스트는 웨딩코드 질문을 다듬기 위한 프로토타입입니다.

결혼 준비를 하다 보면 예산, 견적, 분위기, 가족 조율, 상대와의 역할 분담처럼 여러 기준을 함께 보게 됩니다. 이 테스트는 실제 결혼 준비 상황형 질문을 통해 어떤 질문이 이해하기 쉽고 공감되는지, 그리고 어떤 제품 방향이 도움이 될지 확인하기 위한 3분짜리 테스트입니다.

이 테스트는 심리 진단, 관계 상담, 법률 자문, 결혼 성공 예측, 이혼 예측이 아닙니다.

이번 테스트에서는 최종 유형, 점수, 캐릭터, 4글자 코드가 부여되지 않습니다. 답변은 문항 품질과 제품 방향을 개선하는 데 사용됩니다.`;

export const WC_NO_RIGHT_ANSWER = "정답은 없습니다. 가장 가까운 반응을 골라주세요.";

export const WC_CONSENT_LABEL = "위 내용을 확인했고, 테스트 목적의 응답 수집에 동의합니다.";

export const WC_HYPOTHETICAL_NOTE =
  "아직 겪지 않은 상황일 수 있어요. 그런 상황이라고 상상하고 가장 가까운 반응을 골라주세요.";

export const WC_OPTIONAL_SECTION_TITLE = "아직 겪지 않았을 수 있는 상황";

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

// ── 16문항 (v0.4 — 감정 훅 + 단문 선택지, 구인 매핑은 v0.3과 동일) ──

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
    question: "견적서를 받았는데, 어디서 돈이 더 나올지 감이 안 와요. 이럴 때 나는 —",
    options: [
      { value: "A", label: "뭐가 포함이고 뭐가 추가금인지부터 따져본다" },
      { value: "B", label: "가격보다, 나올 사진·스타일이 우리 느낌인지부터 본다" },
      { value: "C", label: "둘이서 '꼭 필요한 것'부터 추린다" },
      { value: "D", label: "실제 해본 사람들 후기를 찾아본다" },
    ],
  },
  {
    key: "q02", id: "WC-Q-experienceMeaning-001", construct: "experienceMeaning", required: true,
    question: "이건 두고두고 기억에 남을 것 같은데, 추가 비용이 있대요. 이럴 때 나는 —",
    options: [
      { value: "A", label: "시간이 지나도 의미 있을지를 먼저 생각한다" },
      { value: "B", label: "예산 안에서 감당되는지부터 계산한다" },
      { value: "C", label: "비슷한 느낌의 다른 선택지를 찾아본다" },
      { value: "D", label: "어떤 장면을 남기고 싶은지 둘이 얘기한다" },
    ],
  },
  {
    key: "q03", id: "WC-Q-coPreparation-003", construct: "coPreparation", required: true,
    question: "마음에 드는 곳을 찾았는데, 상대는 아직 제대로 못 봤어요. 이럴 때 나는 —",
    options: [
      { value: "A", label: "같이 보면서 처음부터 다시 살펴본다" },
      { value: "B", label: "내가 핵심만 정리하고 마지막 결정만 같이 한다" },
      { value: "C", label: "결정 전에 둘 다 볼 체크 목록부터 만든다" },
      { value: "D", label: "왜 끌렸는지 먼저 말하고 반응을 들어본다" },
    ],
  },
  {
    key: "q04", id: "WC-Q-roleOwnership-006", construct: "roleOwnership", required: true,
    question: "한 명이 알아보고, 결정 전에 둘이 최종 확인하기로 했어요. 이럴 때 우리는 —",
    options: [
      { value: "A", label: "알아본 사람이 요약하고, 같이 승인한다" },
      { value: "B", label: "중요한 건 처음부터 끝까지 둘이 같이 본다" },
      { value: "C", label: "되돌리기 어려운 것(계약·환불)만 집중해서 본다" },
      { value: "D", label: "한 명은 조건을, 다른 한 명은 분위기를 나눠 본다" },
    ],
  },
  {
    key: "q05", id: "WC-Q-evidenceDecision-006", construct: "evidenceDecision", required: true,
    question: "\"그건 그냥 해드릴게요\"라고 했는데, 계약서엔 그 말이 없어요. 이럴 때 나는 —",
    options: [
      { value: "A", label: "문자로라도 남겨달라고 요청한다" },
      { value: "B", label: "그 혜택이 진짜 필요한 건지 따져본다" },
      { value: "C", label: "그 약속 없이도 괜찮은 곳인지 다시 본다" },
      { value: "D", label: "확인될 때까지 결정을 잠깐 미룬다" },
    ],
  },
  {
    key: "q06", id: "WC-Q-aestheticMood-002", construct: "aestheticMood", required: true,
    question: "투어 중 들어간 곳이 딱 '우리 느낌'이었어요. 이럴 때 나는 —",
    options: [
      { value: "A", label: "원하던 분위기가 맞는지 찬찬히 뜯어본다" },
      { value: "B", label: "식대·인원·교통 같은 조건부터 확인한다" },
      { value: "C", label: "사진과 영상에 어떻게 남을지 본다" },
      { value: "D", label: "상대와 가족이 볼 기준을 적어 맞춰본다" },
    ],
  },
  {
    key: "q07", id: "WC-Q-familyIntegration-002", construct: "familyIntegration", required: true,
    question: "우린 분위기에 끌리는데, 부모님은 음식과 교통을 보세요. 이럴 때 나는 —",
    options: [
      { value: "A", label: "부모님 기준부터 구체적으로 들어본다" },
      { value: "B", label: "양쪽 기준을 표 하나에 나란히 적어 비교한다" },
      { value: "C", label: "예산·인원까지 현실적인 차이를 확인한다" },
      { value: "D", label: "우리 기준을 정리해 절충안을 준비한다" },
    ],
  },
  {
    key: "q08", id: "WC-Q-coupleAutonomy-004", construct: "coupleAutonomy", required: true,
    question: "우리 결혼식 기준을 부모님께 말씀드려야 해요. 이럴 때 나는 —",
    options: [
      { value: "A", label: "그 전에 둘의 기준부터 확실히 맞춘다" },
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
    question: "본식 직전, 연락할 곳과 챙길 게 한꺼번에 쏟아진다면 나는 먼저 —",
    options: [
      { value: "A", label: "누가 뭘 맡을지부터 나눈다" },
      { value: "B", label: "마감 순서대로 할 일을 줄 세운다" },
      { value: "C", label: "보낼 안내 문자부터 정리한다" },
      { value: "D", label: "서로 부담부터 얘기하고 일을 나눈다" },
    ],
  },
  {
    key: "q11", id: "WC-Q-decisionPaceRisk-004", construct: "decisionPaceRisk", required: true,
    question: "상담이 너무 좋아서 당장 계약하고 싶어요. 이럴 때 나는 —",
    options: [
      { value: "A", label: "하루 자고 나서도 같은 마음인지 본다" },
      { value: "B", label: "좋았던 점과 걸리는 점을 같이 적어본다" },
      { value: "C", label: "총액과 취소 조건을 확인하고 정한다" },
      { value: "D", label: "다른 후보와 한 번 더 비교해본다" },
    ],
  },
  {
    key: "q12", id: "WC-Q-guidanceNeed-005", construct: "guidanceNeed", required: true,
    gateFlag: "q_guidance_stage_flag",
    question: "견적서가 낯선 항목투성이라면, 나는 —",
    options: [
      { value: "A", label: "먼저 볼 3가지만 콕 집어주면 좋겠다" },
      { value: "B", label: "직접 비교하게 표로 정리해주면 좋겠다" },
      { value: "C", label: "추가금 붙기 쉬운 곳만 표시해주면 좋겠다" },
      { value: "D", label: "둘이 얘기할 질문 목록으로 바꿔주면 좋겠다" },
    ],
  },
  {
    key: "q13", id: "WC-Q-costRisk-001", construct: "costRisk", required: false,
    gateFlag: "q_cost_boundary_flag",
    question: "마음에 쏙 드는 식장이 예산보다 300만 원 비싸요. 이럴 때 나는 —",
    options: [
      { value: "A", label: "총액과 추가금, 환불 조건부터 확인한다" },
      { value: "B", label: "그만큼 오래 남을 곳인지 생각해본다" },
      { value: "C", label: "가족과 하객 동선까지 같이 따져본다" },
      { value: "D", label: "둘의 예산 기준을 다시 맞춰본다" },
    ],
  },
  {
    key: "q14", id: "WC-Q-roleOwnership-003", construct: "roleOwnership", required: false,
    question: "한 명은 스타일, 다른 한 명은 조건 보는 눈이 좋아요. 우리라면 —",
    options: [
      { value: "A", label: "각자 잘 보는 걸 맡고 결과를 공유한다" },
      { value: "B", label: "중요한 후보는 둘 다 같이 본다" },
      { value: "C", label: "한 명이 2~3개로 줄이고 마지막은 함께 정한다" },
      { value: "D", label: "각자 본 내용을 표 하나로 합쳐서 같이 본다" },
    ],
  },
  {
    key: "q15", id: "WC-Q-evidenceDecision-001", construct: "evidenceDecision", required: false,
    question: "느낌은 딱인데, 실제 후기가 별로 없어요. 이럴 때 나는 —",
    options: [
      { value: "A", label: "실제 사례와 포함 조건을 더 찾아본다" },
      { value: "B", label: "우리 취향과 맞는지 한 번 더 본다" },
      { value: "C", label: "비슷한 느낌에 후기 많은 곳을 더 찾아본다" },
      { value: "D", label: "어느 정도 모험까지 괜찮은지 둘이 얘기한다" },
    ],
  },
  {
    key: "q16", id: "WC-Q-coupleAutonomy-002", construct: "coupleAutonomy", required: false,
    gateFlag: "q_autonomy_boundary_flag",
    question: "몇 가지 전통 절차는 줄이고 싶은데, 가족 반응이 걱정돼요. 이럴 때 나는 —",
    options: [
      { value: "A", label: "왜 줄이고 싶은지 둘의 이유부터 정리한다" },
      { value: "B", label: "걱정하실 부분과 설명 방법을 준비한다" },
      { value: "C", label: "지킬 것과 줄일 것을 구분해본다" },
      { value: "D", label: "어떤 점이 좋아지는지 자료로 정리한다" },
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
