export const COURT_SAFETY_COUNTRY = "KR" as const;

/**
 * Central, reviewable safety-resource registry. UI and provider guards import
 * this module instead of copying phone numbers into routes and components.
 */
export const COURT_SAFETY_RESOURCES = [
  {
    id: "police",
    label: "경찰 긴급신고",
    phone: "112",
    href: "tel:112",
    useWhen: "폭력·위협·스토킹 등 범죄 위험이 지금 있거나 곧 발생할 수 있을 때",
  },
  {
    id: "fire-medical",
    label: "구조·구급 신고",
    phone: "119",
    href: "tel:119",
    useWhen: "부상, 응급의료, 자해·타해의 즉각적인 위험이 있을 때",
  },
  {
    id: "suicide-prevention",
    label: "자살예방 상담전화",
    phone: "109",
    href: "tel:109",
    useWhen: "자살·자해 생각으로 힘들어 즉시 전문 상담과 연계가 필요할 때",
  },
  {
    id: "women-emergency",
    label: "여성긴급전화",
    phone: "1366",
    href: "tel:1366",
    useWhen: "가정폭력·성폭력·스토킹·교제폭력 피해 여성이 상담·보호 지원이 필요할 때",
  },
] as const;

export const COURT_IMMEDIATE_SAFETY_MESSAGE =
  "지금 즉시 위험하다면 혼자 해결하려 하지 말고 안전한 장소로 이동해 경찰 112 또는 구조·구급 119에 연락해 주세요.";

export const COURT_SELF_HARM_SAFETY_MESSAGE =
  `${COURT_IMMEDIATE_SAFETY_MESSAGE} 자살·자해 생각으로 힘들다면 자살예방 상담전화 109에 연락하고, 믿을 수 있는 사람에게도 지금 상황을 알려 주세요.`;

export const COURT_VIOLENCE_SAFETY_MESSAGE =
  `지금 위협이나 폭력이 진행 중이거나 곧 발생할 수 있다면 상대와의 합의보다 안전이 먼저예요. ${COURT_IMMEDIATE_SAFETY_MESSAGE} 여성폭력 피해 상담·보호가 필요하다면 1366도 이용할 수 있어요.`;
