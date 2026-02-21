import type { ChecklistItem } from "@/types/database.types";

export interface CategoryChecklistTemplate {
  key: string;
  label: string;
  icon: string;
  tip: string;
  ddayStart: number;
  ddayDeadline: number;
  items: ChecklistItem[];
}

export const CATEGORY_CHECKLISTS: CategoryChecklistTemplate[] = [
  {
    key: "venue",
    label: "예식장",
    icon: "Building2",
    tip: "예식장은 최소 1년 전에 예약하세요. 성수기(5-6월, 9-10월)에는 더 일찍 서두르는 것이 좋습니다.",
    ddayStart: 360,
    ddayDeadline: 270,
    items: [
      { id: "venue_01", label: "예식장 스타일 결정 (호텔/하우스/채플/야외)", done: false },
      { id: "venue_02", label: "후보 3곳 이상 리스트업", done: false },
      { id: "venue_03", label: "예식장 투어 예약 및 방문", done: false },
      { id: "venue_04", label: "식대 메뉴 비교 및 시식", done: false },
      { id: "venue_05", label: "예식 시간대 확정 (오전/오후/저녁)", done: false },
      { id: "venue_06", label: "계약 조건 확인 (위약금, 변경 가능 여부)", done: false },
      { id: "venue_07", label: "계약금 납부 및 계약서 보관", done: false },
      { id: "venue_08", label: "부대시설 확인 (대기실, 주차, 포토존)", done: false },
    ],
  },
  {
    key: "studio",
    label: "스튜디오",
    icon: "Camera",
    tip: "촬영 스타일(자연광/스튜디오/로케이션)을 먼저 정하면 업체 선정이 쉬워집니다.",
    ddayStart: 300,
    ddayDeadline: 150,
    items: [
      { id: "studio_01", label: "촬영 스타일 결정 (실내/야외/혼합)", done: false },
      { id: "studio_02", label: "스튜디오 3곳 이상 비교", done: false },
      { id: "studio_03", label: "포트폴리오 확인 및 상담", done: false },
      { id: "studio_04", label: "패키지 비교 (보정본 수, 원본 제공)", done: false },
      { id: "studio_05", label: "촬영 일정 확정", done: false },
      { id: "studio_06", label: "계약 및 계약금 납부", done: false },
      { id: "studio_07", label: "촬영 콘셉트 및 의상 협의", done: false },
      { id: "studio_08", label: "보정본 확인 및 최종 선택", done: false },
    ],
  },
  {
    key: "dress",
    label: "드레스",
    icon: "Shirt",
    tip: "드레스는 체형에 맞는 라인을 먼저 정하세요. AI 가상 피팅으로 사전 비교하면 시간을 절약할 수 있어요.",
    ddayStart: 300,
    ddayDeadline: 120,
    items: [
      { id: "dress_01", label: "드레스 스타일 결정 (A라인/머메이드/볼가운)", done: false },
      { id: "dress_02", label: "드레스샵 3곳 이상 리스트업", done: false },
      { id: "dress_03", label: "드레스 투어 예약 및 방문", done: false },
      { id: "dress_04", label: "AI 가상 피팅으로 비교", done: false },
      { id: "dress_05", label: "최종 드레스 선정", done: false },
      { id: "dress_06", label: "수선 일정 확정 (2회 이상)", done: false },
      { id: "dress_07", label: "액세서리 매칭 (베일, 티아라, 글러브)", done: false },
      { id: "dress_08", label: "최종 피팅 및 확인", done: false },
    ],
  },
  {
    key: "makeup",
    label: "메이크업",
    icon: "Palette",
    tip: "리허설 메이크업은 본식 최소 1개월 전에 진행하세요. 사진 촬영 후 비교하면 더 좋습니다.",
    ddayStart: 240,
    ddayDeadline: 60,
    items: [
      { id: "makeup_01", label: "메이크업 스타일 결정 (내추럴/글램/클래식)", done: false },
      { id: "makeup_02", label: "메이크업 업체 3곳 비교", done: false },
      { id: "makeup_03", label: "포트폴리오 및 후기 확인", done: false },
      { id: "makeup_04", label: "리허설 메이크업 예약", done: false },
      { id: "makeup_05", label: "리허설 진행 및 사진 촬영", done: false },
      { id: "makeup_06", label: "수정 사항 전달", done: false },
      { id: "makeup_07", label: "본식 메이크업 최종 확정", done: false },
      { id: "makeup_08", label: "어머니 메이크업 예약", done: false },
    ],
  },
  {
    key: "ring",
    label: "예물(반지)",
    icon: "Gem",
    tip: "예물은 양가 예산을 먼저 합의하세요. 브랜드 vs 공방, 디자인 vs 캐럿 등 우선순위를 정하면 선택이 편합니다.",
    ddayStart: 270,
    ddayDeadline: 120,
    items: [
      { id: "ring_01", label: "예물 예산 양가 합의", done: false },
      { id: "ring_02", label: "예물 종류 결정 (반지, 시계, 목걸이 등)", done: false },
      { id: "ring_03", label: "브랜드 vs 공방 결정", done: false },
      { id: "ring_04", label: "매장 3곳 이상 방문 비교", done: false },
      { id: "ring_05", label: "디자인 및 사이즈 확정", done: false },
      { id: "ring_06", label: "주문 및 계약금 납부", done: false },
      { id: "ring_07", label: "각인 문구 결정 (해당 시)", done: false },
      { id: "ring_08", label: "최종 수령 및 확인", done: false },
    ],
  },
  {
    key: "hanbok",
    label: "한복",
    icon: "Flower2",
    tip: "맞춤 한복은 최소 3개월이 소요됩니다. 양가 어머니 한복도 함께 준비하세요.",
    ddayStart: 180,
    ddayDeadline: 60,
    items: [
      { id: "hanbok_01", label: "한복 유형 결정 (맞춤/대여)", done: false },
      { id: "hanbok_02", label: "양가 어머니 한복 포함 여부 결정", done: false },
      { id: "hanbok_03", label: "한복집 3곳 비교 방문", done: false },
      { id: "hanbok_04", label: "원단 및 색상 선택", done: false },
      { id: "hanbok_05", label: "치수 측정 및 주문", done: false },
      { id: "hanbok_06", label: "중간 가봉 확인", done: false },
      { id: "hanbok_07", label: "최종 수령 및 피팅", done: false },
    ],
  },
  {
    key: "honeymoon",
    label: "신혼여행",
    icon: "Plane",
    tip: "항공권은 빨리 예약할수록 저렴합니다. 결혼식 직후 출발이면 공항까지의 동선도 미리 계획하세요.",
    ddayStart: 180,
    ddayDeadline: 30,
    items: [
      { id: "honeymoon_01", label: "여행지 결정 (국내/해외)", done: false },
      { id: "honeymoon_02", label: "여행 일정 및 기간 확정", done: false },
      { id: "honeymoon_03", label: "항공권 예약", done: false },
      { id: "honeymoon_04", label: "숙소 예약", done: false },
      { id: "honeymoon_05", label: "여행자 보험 가입", done: false },
      { id: "honeymoon_06", label: "여권/비자 확인 및 갱신", done: false },
      { id: "honeymoon_07", label: "현지 투어/액티비티 예약", done: false },
      { id: "honeymoon_08", label: "환전 및 카드 준비", done: false },
    ],
  },
  {
    key: "houseware",
    label: "혼수",
    icon: "Home",
    tip: "혼수는 양가 분담 항목을 먼저 정하세요. 가전은 할인 시즌을 노리면 수백만원을 아낄 수 있습니다.",
    ddayStart: 180,
    ddayDeadline: 30,
    items: [
      { id: "houseware_01", label: "혼수 양가 분담 항목 합의", done: false },
      { id: "houseware_02", label: "필수 가전 리스트 작성", done: false },
      { id: "houseware_03", label: "가전 가격 비교 및 구매", done: false },
      { id: "houseware_04", label: "가구 리스트 및 배치 계획", done: false },
      { id: "houseware_05", label: "가구 구매 및 배송 일정 확인", done: false },
      { id: "houseware_06", label: "침구/생활용품 구매", done: false },
      { id: "houseware_07", label: "신혼집 입주 및 정리", done: false },
    ],
  },
  {
    key: "invitation",
    label: "청첩장",
    icon: "Mail",
    tip: "모바일 청첩장은 2개월 전, 종이 청첩장은 3개월 전에 준비를 시작하세요.",
    ddayStart: 120,
    ddayDeadline: 45,
    items: [
      { id: "invitation_01", label: "청첩장 유형 결정 (종이/모바일/둘다)", done: false },
      { id: "invitation_02", label: "디자인 시안 선택", done: false },
      { id: "invitation_03", label: "문구 및 정보 작성", done: false },
      { id: "invitation_04", label: "하객 명단 정리 및 수량 확정", done: false },
      { id: "invitation_05", label: "청첩장 주문/제작", done: false },
      { id: "invitation_06", label: "수령 및 오류 확인", done: false },
      { id: "invitation_07", label: "청첩장 발송 (2개월 전)", done: false },
    ],
  },
  {
    key: "gift",
    label: "답례품",
    icon: "Gift",
    tip: "답례품은 식대 인원 확정 후 여유분 10% 추가로 주문하세요.",
    ddayStart: 90,
    ddayDeadline: 14,
    items: [
      { id: "gift_01", label: "답례품 예산 설정", done: false },
      { id: "gift_02", label: "답례품 유형 결정 (식기/생활용품/식품)", done: false },
      { id: "gift_03", label: "답례품 업체 비교", done: false },
      { id: "gift_04", label: "샘플 확인", done: false },
      { id: "gift_05", label: "최종 하객 수량 기준 주문", done: false },
      { id: "gift_06", label: "포장 상태 확인", done: false },
      { id: "gift_07", label: "예식장 배송 일정 확인", done: false },
    ],
  },
];

// 카테고리 키로 템플릿 빠르게 조회
export const CHECKLIST_MAP = Object.fromEntries(
  CATEGORY_CHECKLISTS.map((c) => [c.key, c])
) as Record<string, CategoryChecklistTemplate>;
