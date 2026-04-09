export interface NotificationTemplate {
  id: string;
  type: "schedule" | "budget" | "ai";
  ddayTrigger: number;
  categoryKey?: string;
  title: string;
  message: string;
  priority: "high" | "medium" | "low";
}

export const NOTIFICATION_TEMPLATES: NotificationTemplate[] = [
  // D-360: 초기 준비
  { id: "n_venue_start", type: "schedule", ddayTrigger: 360, categoryKey: "venue", title: "예식장 준비를 시작하세요", message: "결혼식 1년 전, 예식장 투어를 시작할 시기입니다.", priority: "high" },
  { id: "n_budget_setup", type: "budget", ddayTrigger: 360, title: "결혼 예산을 설정하세요", message: "양가 상의 후 총 예산을 확정하면 효율적으로 준비할 수 있어요.", priority: "medium" },

  // D-300: 핵심 계약
  { id: "n_studio_start", type: "schedule", ddayTrigger: 300, categoryKey: "studio", title: "스튜디오 알아보기", message: "촬영 스타일을 정하고 스튜디오를 비교해보세요.", priority: "medium" },
  { id: "n_dress_start", type: "schedule", ddayTrigger: 300, categoryKey: "dress", title: "드레스 투어 시작", message: "드레스샵 방문을 시작할 시기입니다.", priority: "medium" },

  // D-270: 예물
  { id: "n_ring_start", type: "schedule", ddayTrigger: 270, categoryKey: "ring", title: "예물 준비 시작", message: "예물 예산을 합의하고 매장 방문을 시작하세요.", priority: "medium" },

  // D-240: 메이크업
  { id: "n_makeup_start", type: "schedule", ddayTrigger: 240, categoryKey: "makeup", title: "메이크업 업체 알아보기", message: "메이크업 스타일을 정하고 업체를 비교해보세요.", priority: "medium" },

  // D-180: 세부 준비
  { id: "n_hanbok_start", type: "schedule", ddayTrigger: 180, categoryKey: "hanbok", title: "한복 준비 시작", message: "맞춤 한복은 3개월 이상 소요됩니다. 지금 시작하세요.", priority: "medium" },
  { id: "n_honeymoon_start", type: "schedule", ddayTrigger: 180, categoryKey: "honeymoon", title: "신혼여행 계획", message: "항공권은 빨리 예약할수록 저렴합니다.", priority: "medium" },
  { id: "n_houseware_start", type: "schedule", ddayTrigger: 180, categoryKey: "houseware", title: "혼수 준비 시작", message: "양가 분담 항목을 합의하세요.", priority: "low" },

  // D-120: 청첩장
  { id: "n_invitation_start", type: "schedule", ddayTrigger: 120, categoryKey: "invitation", title: "청첩장 준비", message: "디자인을 선택하고 하객 명단을 정리하세요.", priority: "medium" },

  // D-90: 마무리
  { id: "n_gift_start", type: "schedule", ddayTrigger: 90, categoryKey: "gift", title: "답례품 준비", message: "답례품 업체를 비교하고 샘플을 확인하세요.", priority: "medium" },

  // D-60: 긴급 알림
  { id: "n_venue_urgent", type: "schedule", ddayTrigger: 60, categoryKey: "venue", title: "예식장 확인 필요!", message: "예식장이 아직 미정이라면 서둘러야 합니다.", priority: "high" },
  { id: "n_makeup_rehearsal", type: "schedule", ddayTrigger: 60, categoryKey: "makeup", title: "메이크업 리허설 시기", message: "본식 메이크업 리허설을 진행하세요.", priority: "high" },

  // D-30: 최종 점검
  { id: "n_final_check", type: "schedule", ddayTrigger: 30, title: "최종 점검 시기", message: "남은 준비 사항을 모두 최종 점검하세요.", priority: "high" },
  { id: "n_guest_final", type: "schedule", ddayTrigger: 30, title: "하객 명단 최종 확정", message: "식대 인원을 예식장에 통보하세요.", priority: "high" },
];
