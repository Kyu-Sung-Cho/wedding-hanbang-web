export const AMORA_PREPARATION_COVERAGE_CONTRACT_VERSION = 1;

const JOURNEY_AXES = Object.freeze([
  { axisKey: "foundation", label: "시작 설계" },
  { axisKey: "couple_and_family", label: "두 사람과 가족" },
  { axisKey: "venue_and_guests", label: "장소와 하객" },
  { axisKey: "photo_and_style", label: "촬영과 스타일" },
  { axisKey: "ceremony_program", label: "본식 구성" },
  { axisKey: "vendors_and_money", label: "업체와 돈" },
  { axisKey: "home_and_life", label: "생활 준비" },
  { axisKey: "travel_and_admin", label: "여행과 행정" },
  { axisKey: "final_operations", label: "직전 운영" },
  { axisKey: "post_wedding", label: "결혼 뒤 정리" },
]);

const CHECKLIST_TOPIC_AXES = Object.freeze({
  meeting: ["couple_and_family"],
  venue: ["venue_and_guests", "vendors_and_money", "final_operations"],
  studio: ["photo_and_style", "vendors_and_money"],
  dress: ["photo_and_style", "vendors_and_money", "final_operations"],
  makeup: ["photo_and_style", "vendors_and_money", "final_operations"],
  ring: ["photo_and_style", "vendors_and_money"],
  hanbok: ["couple_and_family", "photo_and_style"],
  yedan: ["couple_and_family", "vendors_and_money"],
  honeymoon: ["travel_and_admin", "vendors_and_money", "post_wedding"],
  houseware: ["home_and_life", "vendors_and_money"],
  housing: ["home_and_life", "vendors_and_money"],
  invitation: ["venue_and_guests", "ceremony_program"],
  snap: ["photo_and_style", "ceremony_program", "vendors_and_money", "final_operations"],
  shoes: ["photo_and_style", "final_operations"],
  bouquet: ["ceremony_program", "vendors_and_money", "final_operations"],
  gift: ["venue_and_guests", "ceremony_program", "final_operations"],
  mc: ["ceremony_program", "final_operations"],
  ham: ["couple_and_family"],
  pyebaek: ["couple_and_family", "ceremony_program"],
});

const COVERAGE_GAPS = Object.freeze([
  {
    gapKey: "planning_foundation",
    label: "시작 설계 정본",
    disposition: "now",
    surfaceOwner: "onboarding_and_amora",
    axisKeys: ["foundation"],
    reason: "예식일·전체 예산·예식 방식·우선순위·역할·현재 완료 상태를 하나의 주제로 검증하는 연결이 아직 없다.",
    requiredSourceKinds: ["journey", "budget", "decision"],
  },
  {
    gapKey: "guest_operations",
    label: "하객 운영",
    disposition: "known_gap",
    surfaceOwner: "preparation_map",
    axisKeys: ["venue_and_guests"],
    reason: "하객 명단·참석 확인·좌석·식사·교통·숙박·접근성을 함께 관리하는 정본이 아직 없다.",
    requiredSourceKinds: ["guest", "schedule", "decision"],
  },
  {
    gapKey: "contract_record_safety",
    label: "계약과 지급 기록 안전",
    disposition: "known_gap",
    surfaceOwner: "preparation_topic",
    axisKeys: ["vendors_and_money"],
    reason: "사용자가 직접 확인한 포함·불포함·변경·취소 기한과 지급 기록을 업체별로 다시 확인하는 정본이 아직 없다.",
    requiredSourceKinds: ["vendor", "contract", "budget"],
  },
  {
    gapKey: "contract_transaction_execution",
    label: "계약·결제·취소 실행",
    disposition: "parked",
    surfaceOwner: "none",
    axisKeys: ["vendors_and_money"],
    reason: "업체 계약·결제·취소·환불 실행은 현재 아모라 준비 도움의 범위가 아니며 별도 사용자 승인 전 개발하지 않는다.",
    requiredSourceKinds: ["vendor", "contract", "payment", "legal_review"],
  },
  {
    gapKey: "marriage_admin",
    label: "결혼 관련 행정 확인",
    disposition: "known_gap",
    surfaceOwner: "preparation_map",
    axisKeys: ["travel_and_admin"],
    reason: "커플에게 필요한 행정 항목과 공식 근거를 현재 상황에 맞춰 확인하는 연결이 아직 없다.",
    requiredSourceKinds: ["verified_guide", "decision"],
  },
  {
    gapKey: "wedding_day_operations",
    label: "본식 직전과 당일 운영",
    disposition: "known_gap",
    surfaceOwner: "preparation_map",
    axisKeys: ["ceremony_program", "final_operations"],
    reason: "연락망·시간표·물품·이동·돌발 상황·미지급·미수령을 한 흐름으로 확인하는 정본이 아직 없다.",
    requiredSourceKinds: ["schedule", "contact", "checklist", "budget"],
  },
  {
    gapKey: "post_wedding_closeout",
    label: "결혼 뒤 마감 정리",
    disposition: "known_gap",
    surfaceOwner: "preparation_map",
    axisKeys: ["post_wedding"],
    reason: "결과물 수령·정산·대여품 반납·감사 연락·남은 행정과 기록 보관을 마감하는 정본이 아직 없다.",
    requiredSourceKinds: ["deliverable", "budget", "checklist", "verified_guide"],
  },
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function auditAmoraPreparationCoverage({ checklistTopics }) {
  const topics = Array.isArray(checklistTopics) ? checklistTopics : [];
  const seenTopicKeys = new Set();
  const issues = [];
  const connectedChecklistTopics = topics.flatMap((topic, inputIndex) => {
    if (
      !isRecord(topic)
      || typeof topic.key !== "string"
      || topic.key.length === 0
      || typeof topic.label !== "string"
      || topic.label.trim().length === 0
    ) {
      issues.push(Object.freeze({ code: "invalid_checklist_topic", inputIndex }));
      return [];
    }
    if (!Object.prototype.hasOwnProperty.call(CHECKLIST_TOPIC_AXES, topic.key)) {
      issues.push(Object.freeze({
        code: "unmapped_checklist_topic",
        topicKey: topic.key,
        inputIndex,
      }));
      return [];
    }
    if (seenTopicKeys.has(topic.key)) {
      issues.push(Object.freeze({
        code: "duplicate_checklist_topic",
        topicKey: topic.key,
        inputIndex,
      }));
      return [];
    }
    seenTopicKeys.add(topic.key);
    return [Object.freeze({
      topicKey: topic.key,
      label: topic.label,
      applicability: "explicit_not_applicable_supported",
      axisKeys: Object.freeze([...CHECKLIST_TOPIC_AXES[topic.key]]),
    })];
  });
  for (const topicKey of Object.keys(CHECKLIST_TOPIC_AXES)) {
    if (!seenTopicKeys.has(topicKey)) {
      issues.push(Object.freeze({ code: "missing_checklist_topic", topicKey }));
    }
  }
  const axes = JOURNEY_AXES.map((axis) => {
    const connectedTopicKeys = connectedChecklistTopics
      .filter((topic) => topic.axisKeys.includes(axis.axisKey))
      .map((topic) => topic.topicKey);
    const gapKeys = COVERAGE_GAPS
      .filter((gap) => gap.axisKeys.includes(axis.axisKey))
      .map((gap) => gap.gapKey);
    return Object.freeze({
      ...axis,
      status: connectedTopicKeys.length === 0
        ? "gap"
        : gapKeys.length > 0 ? "partial" : "connected",
      connectedTopicKeys: Object.freeze(connectedTopicKeys),
      gapKeys: Object.freeze(gapKeys),
    });
  });

  return Object.freeze({
    version: AMORA_PREPARATION_COVERAGE_CONTRACT_VERSION,
    scope: "full_wedding_journey",
    axes: Object.freeze(axes),
    connectedChecklistTopics: Object.freeze(connectedChecklistTopics),
    gaps: Object.freeze(COVERAGE_GAPS.map((gap) => Object.freeze({
      ...gap,
      axisKeys: Object.freeze([...gap.axisKeys]),
      requiredSourceKinds: Object.freeze([...gap.requiredSourceKinds]),
    }))),
    issues: Object.freeze(issues),
    isComplete: false,
  });
}
