import type { CourtCategory, CourtTone } from "@/lib/coupleCourt/types";

export interface CourtCategoryDefinition {
  id: CourtCategory;
  label: string;
  description: string;
  questionPrompts: readonly string[];
}

export const COURT_CATEGORY_CATALOG: readonly CourtCategoryDefinition[] = [
  { id: "budget", label: "예산 및 추가금", description: "공동 예산, 추가 비용, 부담 방식을 정리해요.", questionPrompts: ["원래 합의한 예산과 추가된 금액은 각각 얼마인가요?", "결제 전 상의 여부와 비용 부담 방식은 어떻게 정했나요?"] },
  { id: "planning_roles", label: "준비 역할 분담", description: "담당자, 마감일, 요청 방식을 구체화해요.", questionPrompts: ["처음에 누가 무엇을 맡기로 했고 마감일은 언제였나요?", "몇 번 요청했으며 늦어지면서 실제로 생긴 문제는 무엇인가요?"] },
  { id: "venue", label: "웨딩홀 선택", description: "장소, 이동, 날짜와 예산의 우선순위를 비교해요.", questionPrompts: ["두 사람이 각각 포기하기 어려운 웨딩홀 조건은 무엇인가요?", "후보를 결정하거나 예약해야 하는 마감은 언제인가요?"] },
  { id: "studio_dress_makeup", label: "스튜디오·드레스·메이크업", description: "취향, 패키지, 추가 옵션과 비용을 함께 살펴요.", questionPrompts: ["어떤 선택이나 추가 옵션을 누가 제안했고 사전에 상의했나요?", "취향, 품질, 일정, 비용 가운데 우선할 기준은 무엇인가요?"] },
  { id: "family", label: "양가 부모님 의견", description: "두 사람의 의견과 양가의 기대를 구분해요.", questionPrompts: ["어느 쪽 부모님의 의견이며 본인의 생각과 같은가요?", "부모님께 전달하기 전에 두 사람이 합의한 원칙이 있었나요?"] },
  { id: "guests_invitations", label: "하객 및 청첩장", description: "하객 범위, 인원, 문구와 전달 역할을 조율해요.", questionPrompts: ["처음 합의한 하객 범위나 청첩장 기준과 달라진 점은 무엇인가요?", "누가 언제까지 확인하거나 전달하기로 했나요?"] },
  { id: "honeymoon", label: "신혼여행", description: "예산, 휴가, 여행 방식과 예약 일정을 비교해요.", questionPrompts: ["각자의 필수 일정과 예산 상한은 무엇인가요?", "휴양·관광·이동 중 우선순위가 어떻게 다른가요?"] },
  { id: "home_setup", label: "혼수 및 신혼집", description: "필요한 혼수, 주거 조건과 부담 가능한 비용을 맞춰요.", questionPrompts: ["꼭 필요한 혼수나 신혼집 조건과 생략 가능한 항목은 무엇인가요?", "각자가 부담할 수 있는 금액과 일정은 어떻게 다른가요?"] },
  { id: "communication", label: "연락 및 답변 속도", description: "답변 기한, 말투와 의사결정 방식을 맞춰요.", questionPrompts: ["답이 필요했던 시점과 실제 답변 시점은 언제였나요?", "바로 답하기 어렵다면 어떤 확인 방식에 합의할 수 있나요?"] },
  { id: "formalwear_shooting", label: "예복 및 촬영 의상", description: "예복, 한복, 촬영 의상의 취향·일정·비용을 정리해요.", questionPrompts: ["어떤 의상 선택에서 의견이 달랐고 결정 기한은 언제인가요?", "대여·구매·추가금 가운데 미리 합의하지 못한 부분은 무엇인가요?"] },
  { id: "ceremony_events", label: "예식 순서 및 이벤트", description: "축가, 영상, 사회와 예식 순서의 결정 권한을 맞춰요.", questionPrompts: ["어떤 순서나 이벤트를 누가 언제 결정했나요?", "두 사람이 사전 확인하기로 한 범위와 마감은 무엇인가요?"] },
  { id: "other", label: "기타 결혼 준비 갈등", description: "다른 분류에 담기 어려운 결혼 준비 의견 차이를 정리해요.", questionPrompts: ["결혼 준비의 어떤 결정이나 업무에서 갈등이 생겼나요?", "누가 무엇을 언제까지 정하면 다음 단계로 갈 수 있나요?"] },
] as const;

export const COURT_TONE_CATALOG: Readonly<Record<CourtTone, {
  label: string;
  description: string;
}>> = {
  gentle: { label: "다정맛", description: "마음을 살피고 부드럽게 정리해요." },
  practical: { label: "현실맛", description: "누가 무엇을 언제까지 할지 분명히 해요." },
  spicy: { label: "매운맛", description: "사람을 조롱하지 않는 선에서 상황만 재치 있게 짚어요." },
};

export interface CourtExampleCase {
  id: string;
  isExample: true;
  badge: "예시";
  category: CourtCategory;
  title: string;
  summary: string;
}

export const COURT_EXAMPLE_CASES: readonly CourtExampleCase[] = [
  { id: "example-final-judge", isExample: true, badge: "예시", category: "communication", title: "아무거나라더니 최종 심사위원이 된 사건", summary: "선택을 맡겼지만 후보마다 뒤늦게 반대 의견이 나온 상황" },
  { id: "example-dress-extra", isExample: true, badge: "예시", category: "studio_dress_makeup", title: "드레스 추가금 80만 원 선결제 사건", summary: "추가 옵션을 결제하기 전에 상의가 필요했는지 다투는 상황" },
  { id: "example-venue-tours", isExample: true, badge: "예시", category: "planning_roles", title: "웨딩홀 투어 예약을 한 사람만 한 사건", summary: "웨딩홀 조사와 예약 업무가 한 사람에게 몰린 상황" },
  { id: "example-invitation-reply", isExample: true, badge: "예시", category: "communication", title: "청첩장 문구 일주일째 답변 없음 사건", summary: "마감이 다가오는데 공동 결정에 답변이 오지 않은 상황" },
  { id: "example-guests-doubled", isExample: true, badge: "예시", category: "guests_invitations", title: "양가 하객 수가 갑자기 두 배가 된 사건", summary: "합의한 규모보다 가족 측 예상 하객이 크게 늘어난 상황" },
  { id: "example-honeymoon-budget", isExample: true, badge: "예시", category: "honeymoon", title: "신혼여행 예산을 상의 없이 올린 사건", summary: "여행 옵션 변경으로 공동 예산이 늘어난 상황" },
  { id: "example-photo-selection", isExample: true, badge: "예시", category: "studio_dress_makeup", title: "스튜디오 보정본 선택 읽씹 사건", summary: "보정본 선택 기한 전에 의견을 받지 못한 상황" },
  { id: "example-video-deadline", isExample: true, badge: "예시", category: "planning_roles", title: "식전 영상 사진을 마감 날 보낸 사건", summary: "맡은 자료를 마감 직전에 전달해 작업이 급해진 상황" },
  { id: "example-singer-booked", isExample: true, badge: "예시", category: "ceremony_events", title: "축가 친구를 사전 상의 없이 섭외한 사건", summary: "예식 순서에 영향을 주는 섭외를 혼자 확정한 상황" },
  { id: "example-appliance-brands", isExample: true, badge: "예시", category: "home_setup", title: "혼수 가전 브랜드 전쟁 사건", summary: "가격과 선호 브랜드 중 무엇을 우선할지 다른 상황" },
  { id: "example-family-opinion", isExample: true, badge: "예시", category: "family", title: "부모님 의견을 본인 의견처럼 전달한 사건", summary: "가족의 기대와 본인의 생각이 섞여 전달된 상황" },
  { id: "example-group-chat-muted", isExample: true, badge: "예시", category: "communication", title: "웨딩 준비 단톡방 알림을 꺼둔 사건", summary: "준비 관련 확인이 늦어지며 상대가 혼자 대응한 상황" },
] as const;
