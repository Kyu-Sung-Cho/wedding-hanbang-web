export interface ChecklistItem {
  id: string;
  label: string;
  done: boolean;
}

/**
 * 일정·예산·아모라가 함께 쓰는 사용자용 준비 항목 이름.
 *
 * 업계 용어를 처음 보는 사람도 뜻을 유추하지 않도록 일상어를 먼저 쓰고,
 * 필요한 경우에만 익숙한 명칭을 뒤에 덧붙인다.
 */
export const PLANNING_CATEGORY_LABELS = {
  meeting: "부모님 첫 만남",
  venue: "결혼식장",
  studio: "웨딩 사진 촬영",
  dress: "드레스·예식 정장",
  makeup: "헤어·메이크업",
  ring: "결혼반지·기념 선물",
  hanbok: "한복",
  yedan: "두 가족에게 드릴 선물",
  honeymoon: "신혼여행",
  houseware: "가전·가구·생활용품",
  housing: "신혼집",
  invitation: "종이·모바일 초대장",
  snap: "결혼식 날 사진·영상",
  shoes: "결혼식 신발",
  bouquet: "손에 드는 꽃·꽃 장식",
  gift: "결혼식에 온 분께 드릴 선물",
  mc: "결혼식 진행·축하 노래",
  ham: "가족에게 전하는 전통 혼례 선물",
  pyebaek: "결혼식 뒤 전통 인사",
  reserve: "예비비·사용처 미정",
} as const;

export type PlanningCategoryKey = keyof typeof PLANNING_CATEGORY_LABELS;

export interface CategoryChecklistTemplate {
  key: string;
  label: string;
  icon: string;
  tip: string;
  /** 화면 정렬용 기본 확인 시작점이며 실제 계약 시작일이 아니다. */
  ddayStart: number;
  /** 화면 정렬용 기본 확인 시점이며 실제 마감일이 아니다. */
  ddayDeadline: number;
  items: ChecklistItem[];
}

export const CATEGORY_CHECKLISTS: CategoryChecklistTemplate[] = [
  // 기본 확인 순서 1: 먼저 합의할 항목
  {
    key: "meeting",
    label: PLANNING_CATEGORY_LABELS.meeting,
    icon: "Users",
    tip: "두 사람이 양쪽 부모님과 처음 함께 만나는 일정입니다. 날짜·장소·참석자와 이 자리에서 나눌 주제를 미리 맞춰보세요.",
    ddayStart: 360,
    ddayDeadline: 300,
    items: [
      { id: "meeting_01", label: "양쪽 부모님 첫 만남 날짜 조율", done: false },
      { id: "meeting_02", label: "만날 장소 정하고 예약", done: false },
      { id: "meeting_03", label: "참석자와 옷차림 확인", done: false },
      { id: "meeting_04", label: "서로 드릴 선물이 필요한지 합의", done: false },
      { id: "meeting_05", label: "결혼식 날짜와 전체 예산 이야기", done: false },
      { id: "meeting_06", label: "가전·가구와 두 가족에게 드릴 선물의 비용 분담 이야기", done: false },
    ],
  },
  {
    key: "venue",
    label: PLANNING_CATEGORY_LABELS.venue,
    icon: "Building2",
    tip: "원하는 날짜에 가능한 장소가 적을 수 있습니다. 후보 날짜와 예상 하객 수를 정한 뒤 각 장소의 가능 일정과 계약 조건을 확인하세요.",
    ddayStart: 360,
    ddayDeadline: 270,
    items: [
      { id: "venue_01", label: "원하는 결혼식장 형태 정하기", done: false },
      { id: "venue_02", label: "비교할 장소 후보 정리", done: false },
      { id: "venue_03", label: "장소 방문 날짜 예약하고 직접 확인", done: false },
      { id: "venue_04", label: "하객 식사 메뉴와 1인당 금액 확인", done: false },
      { id: "venue_05", label: "결혼식 시간대 정하기", done: false },
      { id: "venue_06", label: "취소·변경 때 내거나 돌려받는 금액 확인", done: false },
      { id: "venue_07", label: "계약금 납부 및 계약서 보관", done: false },
      { id: "venue_08", label: "대기실·주차장·사진 촬영 공간 확인", done: false },
    ],
  },

  // 기본 확인 순서 2: 주요 업체와 상품
  {
    key: "studio",
    label: PLANNING_CATEGORY_LABELS.studio,
    icon: "Camera",
    tip: "원하는 사진 분위기와 촬영 장소를 먼저 이야기한 뒤, 업체가 실제로 찍은 사진과 견적에 포함된 결과물을 비교하세요.",
    ddayStart: 300,
    ddayDeadline: 150,
    items: [
      { id: "studio_01", label: "원하는 사진 분위기와 촬영 장소 정하기", done: false },
      { id: "studio_02", label: "사진 촬영 업체 후보 비교", done: false },
      { id: "studio_03", label: "업체가 실제로 찍은 사진과 이용 후기 확인", done: false },
      { id: "studio_04", label: "받는 사진 수와 보정해 주는 사진 수 확인", done: false },
      { id: "studio_05", label: "촬영 일정 확정", done: false },
      { id: "studio_06", label: "계약 및 계약금 납부", done: false },
      { id: "studio_07", label: "원하는 사진 분위기와 입을 옷 협의", done: false },
      { id: "studio_08", label: "보정해 준 사진 확인하고 받을 사진 선택", done: false },
    ],
  },
  {
    key: "dress",
    label: PLANNING_CATEGORY_LABELS.dress,
    icon: "Shirt",
    tip: "입었을 때의 편안함, 움직임, 원하는 분위기를 함께 보세요. 배우자가 입을 예식용 정장도 필요한지 따로 확인하세요.",
    ddayStart: 300,
    ddayDeadline: 120,
    items: [
      { id: "dress_01", label: "원하는 드레스 분위기와 편안함 기준 정하기", done: false },
      { id: "dress_02", label: "비교할 드레스 매장 후보 정리", done: false },
      { id: "dress_03", label: "드레스 입어볼 날짜 예약하고 방문", done: false },
      { id: "dress_04", label: "최종 드레스 선정", done: false },
      { id: "dress_05", label: "드레스를 몸에 맞게 고치는 날짜 확인", done: false },
      { id: "dress_06", label: "머리에 쓰는 면사포·머리 장식·장갑·신발 포함 여부 확인", done: false },
      { id: "dress_07", label: "배우자 예식 정장 선택하고 대여·맞춤 정하기", done: false },
      { id: "dress_08", label: "결혼식 전 드레스를 입어보고 최종 확인", done: false },
    ],
  },
  {
    key: "makeup",
    label: PLANNING_CATEGORY_LABELS.makeup,
    icon: "Palette",
    tip: "결혼식 전에 헤어와 메이크업을 미리 받아볼지는 업체의 제공 범위와 두 사람의 필요에 따라 정하세요.",
    ddayStart: 240,
    ddayDeadline: 60,
    items: [
      { id: "makeup_01", label: "원하는 헤어·메이크업 분위기 사진 정리", done: false },
      { id: "makeup_02", label: "헤어·메이크업 업체 후보 비교", done: false },
      { id: "makeup_03", label: "업체가 실제로 한 작업과 이용 후기 확인", done: false },
      { id: "makeup_04", label: "결혼식 전에 미리 받아볼 날짜 예약", done: false },
      { id: "makeup_05", label: "미리 받아보고 사진으로 남겨 확인", done: false },
      { id: "makeup_06", label: "수정 사항 전달", done: false },
      { id: "makeup_07", label: "결혼식 날 헤어·메이크업 최종 확인", done: false },
      { id: "makeup_08", label: "부모님 헤어·메이크업이 필요한지 확인", done: false },
    ],
  },
  {
    key: "ring",
    label: PLANNING_CATEGORY_LABELS.ring,
    icon: "Gem",
    tip: "결혼반지나 기념 선물을 준비한다면 누가 비용을 내는지, 전체 금액, 필요한 품목과 수령 날짜를 먼저 정리하세요.",
    ddayStart: 270,
    ddayDeadline: 120,
    items: [
      { id: "ring_01", label: "결혼반지·기념 선물 전체 예산 정하기", done: false },
      { id: "ring_02", label: "준비할 품목 정하기", done: false },
      { id: "ring_03", label: "완성된 반지를 파는 매장과 직접 만들어 주는 매장 비교", done: false },
      { id: "ring_04", label: "후보 매장 방문하고 가격·조건 비교", done: false },
      { id: "ring_05", label: "디자인 및 사이즈 확정", done: false },
      { id: "ring_06", label: "주문 및 계약금 납부", done: false },
      { id: "ring_07", label: "반지 안쪽에 새길 문구 정하기 (필요한 경우)", done: false },
      { id: "ring_08", label: "최종 수령 및 확인", done: false },
    ],
  },

  // 기본 확인 순서 3: 생활과 가족 관련 항목
  {
    key: "hanbok",
    label: PLANNING_CATEGORY_LABELS.hanbok,
    icon: "Flower2",
    tip: "한복을 입을 사람과 맞춤·대여 여부를 정한 뒤, 업체가 안내한 제작 또는 대여 기간과 수령 날짜를 확인하세요.",
    ddayStart: 180,
    ddayDeadline: 60,
    items: [
      { id: "hanbok_01", label: "한복을 맞출지 빌릴지 정하기", done: false },
      { id: "hanbok_02", label: "한복을 입을 사람 정하기", done: false },
      { id: "hanbok_03", label: "한복 업체 후보 방문하고 비교", done: false },
      { id: "hanbok_04", label: "한복 천과 색상 선택", done: false },
      { id: "hanbok_05", label: "치수 측정 및 주문", done: false },
      { id: "hanbok_06", label: "완성 전에 치수와 모양 중간 확인", done: false },
      { id: "hanbok_07", label: "완성된 한복 입어보고 수령", done: false },
    ],
  },
  {
    key: "yedan",
    label: PLANNING_CATEGORY_LABELS.yedan,
    icon: "Package",
    tip: "두 가족에게 선물을 준비할지는 가족과 먼저 합의하세요. 진행한다면 품목, 금액, 전달 방법을 적어두세요.",
    ddayStart: 180,
    ddayDeadline: 60,
    items: [
      { id: "yedan_01", label: "두 가족에게 드릴 선물을 준비할지 가족과 합의", done: false },
      { id: "yedan_02", label: "준비할 품목과 전체 예산 정하기", done: false },
      { id: "yedan_03", label: "필요한 품목의 업체와 가격 비교", done: false },
      { id: "yedan_04", label: "최종 선물 품목과 수량 확인", done: false },
      { id: "yedan_05", label: "포장과 전달 날짜 확인", done: false },
      { id: "yedan_06", label: "두 가족에게 선물 전달 완료", done: false },
    ],
  },
  {
    key: "honeymoon",
    label: PLANNING_CATEGORY_LABELS.honeymoon,
    icon: "Plane",
    tip: "여행지와 기간을 정한 뒤 항공·숙소의 취소 조건과 여권·비자 필요 여부를 공식 안내에서 확인하세요.",
    ddayStart: 180,
    ddayDeadline: 30,
    items: [
      { id: "honeymoon_01", label: "국내 또는 해외 여행지 정하기", done: false },
      { id: "honeymoon_02", label: "여행 일정 및 기간 확정", done: false },
      { id: "honeymoon_03", label: "항공권 예약", done: false },
      { id: "honeymoon_04", label: "숙소 예약", done: false },
      { id: "honeymoon_05", label: "여행자 보험 가입", done: false },
      { id: "honeymoon_06", label: "여권과 비자 필요 여부 확인하고 갱신", done: false },
      { id: "honeymoon_07", label: "현지 여행 프로그램 예약 (필요한 경우)", done: false },
      { id: "honeymoon_08", label: "환전 및 카드 준비", done: false },
    ],
  },
  {
    key: "houseware",
    label: PLANNING_CATEGORY_LABELS.houseware,
    icon: "Home",
    tip: "가전·가구·생활용품은 실제로 필요한 목록과 공간 크기를 먼저 확인하고, 비용을 누가 얼마나 낼지 정리하세요.",
    ddayStart: 180,
    ddayDeadline: 30,
    items: [
      { id: "houseware_01", label: "가전·가구 비용을 누가 얼마나 낼지 합의", done: false },
      { id: "houseware_02", label: "필요한 가전 목록 작성", done: false },
      { id: "houseware_03", label: "가전 가격 비교 및 구매", done: false },
      { id: "houseware_04", label: "가구 리스트 및 배치 계획", done: false },
      { id: "houseware_05", label: "가구 구매 및 배송 일정 확인", done: false },
      { id: "houseware_06", label: "침구와 생활용품 구매", done: false },
      { id: "houseware_07", label: "신혼집 입주 및 정리", done: false },
    ],
  },
  {
    key: "housing",
    label: PLANNING_CATEGORY_LABELS.housing,
    icon: "Key",
    tip: "예산, 출퇴근, 교통, 생활 편의를 함께 비교하세요. 대출이나 임대 조건은 금융기관과 계약 문서에서 직접 확인하세요.",
    ddayStart: 180,
    ddayDeadline: 60,
    items: [
      { id: "housing_01", label: "신혼집을 보증금으로 빌릴지, 살지, 매달 임대료를 낼지 정하기", done: false },
      { id: "housing_02", label: "지역 및 예산 범위 확정", done: false },
      { id: "housing_03", label: "부동산 방문 및 매물 탐색", done: false },
      { id: "housing_04", label: "대출이 필요하다면 금융기관에서 조건 확인", done: false },
      { id: "housing_05", label: "계약 및 계약금 납부", done: false },
      { id: "housing_06", label: "집 수리·벽지·바닥 공사가 필요한지 결정", done: false },
      { id: "housing_07", label: "입주 청소 및 이사 일정 확정", done: false },
    ],
  },

  // 기본 확인 순서 4: 결혼식 전 세부 항목
  {
    key: "invitation",
    label: PLANNING_CATEGORY_LABELS.invitation,
    icon: "Mail",
    tip: "종이와 모바일 중 필요한 형태를 정하고, 제작 업체의 실제 소요 기간과 발송할 날짜를 확인하세요.",
    ddayStart: 120,
    ddayDeadline: 45,
    items: [
      { id: "invitation_01", label: "종이·모바일 초대장 중 필요한 형태 정하기", done: false },
      { id: "invitation_02", label: "초대장 디자인 초안 선택", done: false },
      { id: "invitation_03", label: "문구 및 정보 작성", done: false },
      { id: "invitation_04", label: "하객 명단 정리 및 수량 확정", done: false },
      { id: "invitation_05", label: "초대장 주문·제작", done: false },
      { id: "invitation_06", label: "수령 및 오류 확인", done: false },
      { id: "invitation_07", label: "초대장 보낼 날짜 정하고 발송", done: false },
    ],
  },
  {
    key: "snap",
    label: PLANNING_CATEGORY_LABELS.snap,
    icon: "Video",
    tip: "결혼식 날 사진과 영상은 서로 다른 상품일 수 있습니다. 촬영 시간, 받는 파일 수, 보정 범위, 전달 날짜를 각각 확인하세요.",
    ddayStart: 120,
    ddayDeadline: 30,
    items: [
      { id: "snap_01", label: "결혼식 날 사진·영상 중 필요한 것 정하기", done: false },
      { id: "snap_02", label: "사진 촬영 업체가 실제로 찍은 사진 비교", done: false },
      { id: "snap_03", label: "영상 촬영 업체 비교 (필요한 경우)", done: false },
      { id: "snap_04", label: "자연스러운 장면과 연출 장면의 비중 협의", done: false },
      { id: "snap_05", label: "계약 및 계약금 납부", done: false },
      { id: "snap_06", label: "당일 촬영 동선 사전 협의", done: false },
      { id: "snap_07", label: "보정해 준 사진과 영상을 받는 날짜 확인", done: false },
    ],
  },
  {
    key: "shoes",
    label: PLANNING_CATEGORY_LABELS.shoes,
    icon: "Sparkles",
    tip: "옷 길이와 이동 동선을 고려해 신발 높이와 편안함을 확인하세요. 갈아 신을 신발이 필요한지도 함께 정하세요.",
    ddayStart: 90,
    ddayDeadline: 30,
    items: [
      { id: "shoes_01", label: "드레스에 맞는 굽 높이 결정", done: false },
      { id: "shoes_02", label: "결혼식 신발 모양과 편안함 확인", done: false },
      { id: "shoes_03", label: "결혼식 신발 구매", done: false },
      { id: "shoes_04", label: "결혼식 뒤 식사나 모임에서 갈아 신을 편한 신발 준비", done: false },
      { id: "shoes_05", label: "전통 인사용 꽃신·신발 준비 (필요한 경우)", done: false },
      { id: "shoes_06", label: "배우자 결혼식 신발 준비", done: false },
    ],
  },
  {
    key: "bouquet",
    label: PLANNING_CATEGORY_LABELS.bouquet,
    icon: "Flower",
    tip: "손에 들 꽃이 필요하다면 원하는 분위기, 생화나 인조 꽃 여부, 전달 시간과 보관 방법을 업체와 확인하세요.",
    ddayStart: 90,
    ddayDeadline: 14,
    items: [
      { id: "bouquet_01", label: "손에 들 꽃을 생화·인조 꽃 중에서 정하기", done: false },
      { id: "bouquet_02", label: "원하는 꽃 모양과 크기 정하기", done: false },
      { id: "bouquet_03", label: "꽃 업체 후보 비교하고 정하기", done: false },
      { id: "bouquet_04", label: "꽃 색과 종류를 정해 주문", done: false },
      { id: "bouquet_05", label: "배우자가 옷에 달 작은 꽃 장식도 필요한지 확인", done: false },
      { id: "bouquet_06", label: "결혼식장 꽃 장식이 더 필요한지 협의", done: false },
    ],
  },
  {
    key: "gift",
    label: PLANNING_CATEGORY_LABELS.gift,
    icon: "Gift",
    tip: "하객 선물을 준비한다면 대상 인원, 한 사람당 금액, 수량 변경 기한과 남은 물품의 처리 조건을 확인하세요.",
    ddayStart: 90,
    ddayDeadline: 14,
    items: [
      { id: "gift_01", label: "하객 선물 전체 예산 정하기", done: false },
      { id: "gift_02", label: "선물 종류 정하기", done: false },
      { id: "gift_03", label: "선물 업체와 가격 비교", done: false },
      { id: "gift_04", label: "샘플 확인", done: false },
      { id: "gift_05", label: "최종 하객 수량 기준 주문", done: false },
      { id: "gift_06", label: "포장 상태 확인", done: false },
      { id: "gift_07", label: "결혼식장에 도착할 날짜와 장소 확인", done: false },
    ],
  },
  {
    key: "mc",
    label: PLANNING_CATEGORY_LABELS.mc,
    icon: "Mic",
    tip: "진행자와 축하 노래가 필요한지 정한 뒤, 맡을 사람과 순서, 필요한 장비, 사전 확인 날짜를 맞추세요.",
    ddayStart: 90,
    ddayDeadline: 14,
    items: [
      { id: "mc_01", label: "결혼식 진행을 맡을 사람 정하기", done: false },
      { id: "mc_02", label: "전문 진행자를 이용한다면 계약 조건 확인", done: false },
      { id: "mc_03", label: "축하 노래를 부탁할 사람과 곡 정하기", done: false },
      { id: "mc_04", label: "축하 공연이나 별도 행사가 필요한지 정하기", done: false },
      { id: "mc_05", label: "결혼식 진행 순서를 맡은 사람에게 전달", done: false },
      { id: "mc_06", label: "결혼식 전 진행 순서를 맞춰볼 날짜 정하기", done: false },
    ],
  },
  {
    key: "ham",
    label: PLANNING_CATEGORY_LABELS.ham,
    icon: "Box",
    tip: "전통 혼례 선물인 함을 진행할지는 가족과 먼저 합의하세요. 진행한다면 내용물, 전달 방식, 날짜와 비용을 정리하세요.",
    ddayStart: 60,
    ddayDeadline: 7,
    items: [
      { id: "ham_01", label: "전통 혼례 선물인 함을 진행할지 가족과 합의", done: false },
      { id: "ham_02", label: "전통 방식과 간단한 방식 중 범위 정하기", done: false },
      { id: "ham_03", label: "전달할 사람과 방법 정하기", done: false },
      { id: "ham_04", label: "함에 넣을 물품을 가족과 확인", done: false },
      { id: "ham_05", label: "함을 전달할 날짜 정하기", done: false },
      { id: "ham_06", label: "전달 과정에 드는 비용 확인", done: false },
    ],
  },
  {
    key: "pyebaek",
    label: PLANNING_CATEGORY_LABELS.pyebaek,
    icon: "Heart",
    tip: "결혼식 뒤 전통 인사를 진행할지는 가족과 먼저 합의하세요. 진행한다면 의상, 음식, 장소와 비용을 각각 확인하세요.",
    ddayStart: 60,
    ddayDeadline: 7,
    items: [
      { id: "pyebaek_01", label: "결혼식 뒤 전통 인사를 진행할지 가족과 합의", done: false },
      { id: "pyebaek_02", label: "진행한다면 음식 업체와 품목 정하기", done: false },
      { id: "pyebaek_03", label: "전통 인사에 쓸 음식 주문", done: false },
      { id: "pyebaek_04", label: "결혼식장 안에 진행할 장소가 있는지 확인", done: false },
      { id: "pyebaek_05", label: "진행 순서를 미리 확인", done: false },
      { id: "pyebaek_06", label: "입을 한복과 신발 확인", done: false },
    ],
  },
];

// 카테고리 키로 템플릿 빠르게 조회
export const CHECKLIST_MAP = Object.fromEntries(
  CATEGORY_CHECKLISTS.map((c) => [c.key, c])
) as Record<string, CategoryChecklistTemplate>;
