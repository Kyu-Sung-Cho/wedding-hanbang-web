import { Category, CategoryId } from "@/types";

export const CATEGORIES: Category[] = [
  {
    id: "first_greeting", name: "첫인사", emoji: "🤝", order: 1,
    description: "양가 부모님께 인사드리기",
    suggestedTiming: { earliestDaysBefore: 365, latestDaysBefore: 180 },
    estimatedCost: "10~30만원",
    checklistItems: [
      { id: "fg_1", title: "인사 일정 잡기", description: "양가 일정 조율", aiTip: "주말 점심이 무난해요", isRequired: true, order: 1 },
      { id: "fg_2", title: "선물 준비", description: "양가 부모님 선물", aiTip: "건강식품이 인기있어요", isRequired: true, order: 2 },
      { id: "fg_3", title: "식당 예약", description: "식사 장소 예약", aiTip: "한정식이 무난합니다", isRequired: true, order: 3 },
    ],
    commonMistakes: ["일정을 너무 늦게 잡음", "선물을 깜빡함"],
    tips: ["편안한 복장이 좋아요", "양가 취향을 미리 파악하세요"],
  },
  {
    id: "formal_meeting", name: "상견례", emoji: "🍽️", order: 2,
    description: "양가 가족 공식 만남",
    suggestedTiming: { earliestDaysBefore: 300, latestDaysBefore: 120 },
    estimatedCost: "30~50만원",
    checklistItems: [
      { id: "fm_1", title: "상견례 날짜/장소", description: "양가 협의", aiTip: "호텔 한식당을 추천해요", isRequired: true, order: 1 },
      { id: "fm_2", title: "예절 공부", description: "인사법, 호칭 정리", aiTip: "예절 가이드를 확인하세요", isRequired: true, order: 2 },
      { id: "fm_3", title: "복장 준비", description: "단정한 정장/원피스", aiTip: "너무 화려하지 않게", isRequired: true, order: 3 },
    ],
    commonMistakes: ["예절을 미리 안 찾아봄", "양가 분위기 파악 안 함"],
    tips: ["대화 주제를 미리 준비하세요", "너무 긴장하지 마세요"],
  },
  {
    id: "wedding_hall", name: "웨딩홀", emoji: "🏛️", order: 3,
    description: "결혼식 장소 선택",
    suggestedTiming: { earliestDaysBefore: 365, latestDaysBefore: 180 },
    estimatedCost: "300~800만원",
    checklistItems: [
      { id: "wh_1", title: "예산 설정", description: "웨딩홀 예산 범위 정하기", aiTip: "식사 포함 1인 5~8만원이 평균", isRequired: true, order: 1 },
      { id: "wh_2", title: "후보 리스트업", description: "3~5곳 후보 선정", aiTip: "온라인 후기 먼저 확인하세요", isRequired: true, order: 2 },
      { id: "wh_3", title: "방문 투어", description: "현장 방문 및 비교", aiTip: "주말에 실제 웨딩 분위기를 보세요", isRequired: true, order: 3 },
      { id: "wh_4", title: "계약", description: "날짜/시간 확정 및 계약", aiTip: "계약서 꼼꼼히 확인하세요", isRequired: true, order: 4 },
    ],
    commonMistakes: ["시즌 인기 날짜 놓침", "추가 비용 미확인"],
    tips: ["비수기가 가격이 저렴해요", "주중도 고려해보세요"],
  },
  {
    id: "studio", name: "스튜디오", emoji: "📸", order: 4,
    description: "웨딩 촬영 스튜디오",
    suggestedTiming: { earliestDaysBefore: 180, latestDaysBefore: 90 },
    estimatedCost: "100~300만원",
    checklistItems: [
      { id: "st_1", title: "스타일 결정", description: "촬영 스타일 정하기", aiTip: "SNS에서 좋아하는 스타일을 저장하세요", isRequired: true, order: 1 },
      { id: "st_2", title: "후보 선정", description: "3~5곳 비교", aiTip: "보정 스타일을 꼭 확인하세요", isRequired: true, order: 2 },
      { id: "st_3", title: "방문 상담", description: "실물 사진 확인", aiTip: "실제 앨범을 보세요", isRequired: true, order: 3 },
      { id: "st_4", title: "계약", description: "패키지 선택 및 계약", aiTip: "추가 보정비 확인 필수", isRequired: true, order: 4 },
      { id: "st_5", title: "촬영일 예약", description: "촬영 날짜 확정", aiTip: "2~3달 전 예약 권장", isRequired: true, order: 5 },
    ],
    commonMistakes: ["보정 스타일 미확인", "추가 비용 미확인", "촬영 컷수 미확인"],
    tips: ["패키지 내용을 꼼꼼히 비교하세요", "야외 촬영 포함 여부 확인"],
  },
  {
    id: "dress", name: "드레스", emoji: "👗", order: 5,
    description: "웨딩 드레스 선택",
    suggestedTiming: { earliestDaysBefore: 150, latestDaysBefore: 60 },
    estimatedCost: "50~200만원",
    checklistItems: [
      { id: "dr_1", title: "스타일 리서치", description: "원하는 드레스 스타일", aiTip: "AI 가상 피팅을 해보세요", isRequired: true, order: 1 },
      { id: "dr_2", title: "피팅 예약", description: "드레스샵 방문 예약", aiTip: "평일이 여유로워요", isRequired: true, order: 2 },
      { id: "dr_3", title: "피팅", description: "실제 착용해보기", aiTip: "속옷/신발 준비하세요", isRequired: true, order: 3 },
      { id: "dr_4", title: "결정 및 계약", description: "드레스 선택 확정", aiTip: "수선 일정도 확인하세요", isRequired: true, order: 4 },
    ],
    commonMistakes: ["한 곳에서만 봄", "수선비 미확인"],
    tips: ["여러 스타일을 입어보세요", "동행인은 1~2명이 적당해요"],
  },
  {
    id: "makeup", name: "메이크업", emoji: "💄", order: 6,
    description: "웨딩 메이크업",
    suggestedTiming: { earliestDaysBefore: 120, latestDaysBefore: 30 },
    estimatedCost: "30~80만원",
    checklistItems: [
      { id: "mk_1", title: "스타일 결정", description: "원하는 메이크업 스타일", aiTip: "드레스와 어울리는 톤으로", isRequired: true, order: 1 },
      { id: "mk_2", title: "리허설", description: "메이크업 리허설", aiTip: "본식 1~2달 전 권장", isRequired: true, order: 2 },
      { id: "mk_3", title: "계약", description: "메이크업 확정", aiTip: "헤어 포함 여부 확인", isRequired: true, order: 3 },
    ],
    commonMistakes: ["리허설 안 함", "피부 관리 미리 안 함"],
    tips: ["리허설은 반드시 하세요", "결혼식 2~3달 전부터 피부 관리"],
  },
  {
    id: "snap_dvd", name: "스냅/DVD", emoji: "🎬", order: 7,
    description: "본식 스냅 촬영 및 DVD",
    suggestedTiming: { earliestDaysBefore: 120, latestDaysBefore: 30 },
    estimatedCost: "50~150만원",
    checklistItems: [
      { id: "sd_1", title: "스냅 업체 선정", description: "촬영 스타일 비교", aiTip: "실제 본식 촬영 샘플을 확인하세요", isRequired: true, order: 1 },
      { id: "sd_2", title: "계약", description: "패키지 선택", aiTip: "데이터 전체 제공 여부 확인", isRequired: true, order: 2 },
    ],
    commonMistakes: ["스냅과 DVD 별도 예약 필요한지 미확인"],
    tips: ["데이터 전량 제공 여부를 확인하세요"],
  },
  {
    id: "suit", name: "예복", emoji: "🤵", order: 8,
    description: "신랑 예복 준비",
    suggestedTiming: { earliestDaysBefore: 120, latestDaysBefore: 30 },
    estimatedCost: "20~100만원",
    checklistItems: [
      { id: "su_1", title: "예복 스타일", description: "턱시도/수트 결정", aiTip: "스튜디오 촬영 스타일과 맞추세요", isRequired: true, order: 1 },
      { id: "su_2", title: "피팅/대여", description: "예복 피팅", aiTip: "구매 vs 대여 비교해보세요", isRequired: true, order: 2 },
    ],
    commonMistakes: ["체형 변화 고려 안 함"],
    tips: ["촬영용과 본식용을 구분하세요"],
  },
  {
    id: "hanbok", name: "한복", emoji: "👘", order: 9,
    description: "폐백/전통 한복",
    suggestedTiming: { earliestDaysBefore: 90, latestDaysBefore: 30 },
    estimatedCost: "30~100만원",
    checklistItems: [
      { id: "hb_1", title: "한복 종류", description: "폐백용/촬영용 결정", aiTip: "대여가 합리적이에요", isRequired: true, order: 1 },
      { id: "hb_2", title: "피팅", description: "한복 착용 확인", aiTip: "속치마도 확인하세요", isRequired: true, order: 2 },
    ],
    commonMistakes: ["폐백 한복 안 준비함"],
    tips: ["대여/구매 가격 비교하세요"],
  },
  {
    id: "wedding_nail", name: "웨딩네일", emoji: "💅", order: 10,
    description: "웨딩 네일아트",
    suggestedTiming: { earliestDaysBefore: 7, latestDaysBefore: 1 },
    estimatedCost: "5~15만원",
    checklistItems: [
      { id: "wn_1", title: "네일 디자인", description: "드레스와 어울리는 디자인", aiTip: "심플한 프렌치가 인기예요", isRequired: false, order: 1 },
      { id: "wn_2", title: "시술 예약", description: "결혼식 1~2일 전", aiTip: "젤네일이 오래 유지돼요", isRequired: false, order: 2 },
    ],
    commonMistakes: ["너무 화려하게 함"],
    tips: ["결혼식 1~2일 전이 적당해요"],
  },
  {
    id: "parent_makeup", name: "혼주메이크업", emoji: "👩‍🦳", order: 11,
    description: "양가 어머니 메이크업",
    suggestedTiming: { earliestDaysBefore: 60, latestDaysBefore: 14 },
    estimatedCost: "10~30만원",
    checklistItems: [
      { id: "pm_1", title: "업체 선정", description: "혼주 메이크업 예약", aiTip: "신부 메이크업과 같은 곳이 편해요", isRequired: false, order: 1 },
    ],
    commonMistakes: ["혼주 메이크업 깜빡함"],
    tips: ["신부 메이크업과 패키지로 하면 저렴해요"],
  },
  {
    id: "wedding_ring", name: "결혼반지", emoji: "💍", order: 12,
    description: "결혼반지 구매",
    suggestedTiming: { earliestDaysBefore: 120, latestDaysBefore: 30 },
    estimatedCost: "50~300만원",
    checklistItems: [
      { id: "wr_1", title: "예산 설정", description: "반지 예산 정하기", aiTip: "커플링+결혼반지 합산 고려", isRequired: true, order: 1 },
      { id: "wr_2", title: "브랜드/매장 방문", description: "디자인 비교", aiTip: "각인 서비스 확인하세요", isRequired: true, order: 2 },
      { id: "wr_3", title: "구매", description: "사이즈 측정 및 구매", aiTip: "사이즈는 오후에 재세요", isRequired: true, order: 3 },
    ],
    commonMistakes: ["사이즈 안 맞음", "각인 안 함"],
    tips: ["손가락이 붓는 오후에 사이즈 측정하세요"],
  },
  {
    id: "gifts", name: "예물/예단", emoji: "🎁", order: 13,
    description: "양가 예물/예단 교환",
    suggestedTiming: { earliestDaysBefore: 120, latestDaysBefore: 30 },
    estimatedCost: "100~500만원",
    checklistItems: [
      { id: "gf_1", title: "양가 협의", description: "예물/예단 범위 협의", aiTip: "솔직한 대화가 중요해요", isRequired: true, order: 1 },
      { id: "gf_2", title: "구매", description: "예물/예단 준비", aiTip: "시어머니 취향을 파악하세요", isRequired: true, order: 2 },
    ],
    commonMistakes: ["양가 기대치 차이"],
    tips: ["미리 양가 문화를 파악하세요"],
  },
  {
    id: "invitation", name: "청첩장", emoji: "💌", order: 14,
    description: "결혼 청첩장 제작",
    suggestedTiming: { earliestDaysBefore: 60, latestDaysBefore: 21 },
    estimatedCost: "10~50만원",
    checklistItems: [
      { id: "iv_1", title: "디자인 선택", description: "종이/모바일 청첩장", aiTip: "모바일 청첩장이 트렌드예요", isRequired: true, order: 1 },
      { id: "iv_2", title: "발송", description: "2~3주 전 발송", aiTip: "하객 명단을 미리 정리하세요", isRequired: true, order: 2 },
    ],
    commonMistakes: ["발송 시기 놓침"],
    tips: ["모바일+종이 병행이 좋아요"],
  },
  {
    id: "officiant", name: "주례/사회/축가", emoji: "🎤", order: 15,
    description: "본식 진행 인력",
    suggestedTiming: { earliestDaysBefore: 90, latestDaysBefore: 14 },
    estimatedCost: "10~100만원",
    checklistItems: [
      { id: "of_1", title: "주례 섭외", description: "주례/사회자 결정", aiTip: "무주례 웨딩도 트렌드예요", isRequired: false, order: 1 },
      { id: "of_2", title: "축가 섭외", description: "축가자 결정", aiTip: "리허설을 꼭 하세요", isRequired: false, order: 2 },
    ],
    commonMistakes: ["섭외 시기 늦음"],
    tips: ["무주례 셀프 웨딩도 좋아요"],
  },
  {
    id: "appliances", name: "가전", emoji: "🏠", order: 16,
    description: "신혼 가전 구매",
    suggestedTiming: { earliestDaysBefore: 90, latestDaysBefore: 14 },
    estimatedCost: "500~1500만원",
    checklistItems: [
      { id: "ap_1", title: "필수 가전 리스트", description: "냉장고, 세탁기 등", aiTip: "가전 박람회를 활용하세요", isRequired: true, order: 1 },
      { id: "ap_2", title: "구매", description: "할인 시기 활용", aiTip: "결혼 시즌 할인을 노리세요", isRequired: true, order: 2 },
    ],
    commonMistakes: ["충동구매"],
    tips: ["필수 가전부터 우선순위를 정하세요"],
  },
  {
    id: "furniture", name: "가구", emoji: "🛋️", order: 17,
    description: "신혼 가구 구매",
    suggestedTiming: { earliestDaysBefore: 90, latestDaysBefore: 14 },
    estimatedCost: "300~1000만원",
    checklistItems: [
      { id: "fu_1", title: "가구 리스트", description: "침대, 소파 등", aiTip: "집 크기에 맞게 선택하세요", isRequired: true, order: 1 },
      { id: "fu_2", title: "구매", description: "가구 매장 방문", aiTip: "배송 기간 확인 필수", isRequired: true, order: 2 },
    ],
    commonMistakes: ["크기 미측정"],
    tips: ["실측 후 구매하세요"],
  },
  {
    id: "honeymoon_house", name: "신혼집", emoji: "🏡", order: 18,
    description: "신혼집 구하기",
    suggestedTiming: { earliestDaysBefore: 180, latestDaysBefore: 30 },
    estimatedCost: "지역별 상이",
    checklistItems: [
      { id: "hh_1", title: "예산/지역", description: "신혼집 조건 정하기", aiTip: "출퇴근 시간을 고려하세요", isRequired: true, order: 1 },
      { id: "hh_2", title: "매물 탐색", description: "부동산 방문", aiTip: "직방/네이버 부동산 활용", isRequired: true, order: 2 },
      { id: "hh_3", title: "계약", description: "임대/매매 계약", aiTip: "특약 사항을 꼼꼼히 확인", isRequired: true, order: 3 },
    ],
    commonMistakes: ["통근 시간 미고려"],
    tips: ["양가 중간 지점이 좋아요"],
  },
  {
    id: "honeymoon_trip", name: "신혼여행", emoji: "✈️", order: 19,
    description: "신혼여행 계획",
    suggestedTiming: { earliestDaysBefore: 120, latestDaysBefore: 30 },
    estimatedCost: "200~1000만원",
    checklistItems: [
      { id: "ht_1", title: "여행지 선정", description: "목적지 결정", aiTip: "시즌에 따라 가격 차이가 커요", isRequired: true, order: 1 },
      { id: "ht_2", title: "항공/숙소 예약", description: "예약 진행", aiTip: "조기 예약이 저렴해요", isRequired: true, order: 2 },
    ],
    commonMistakes: ["여권 만료 미확인"],
    tips: ["여권 유효기간을 확인하세요"],
  },
  {
    id: "return_gifts", name: "답례품", emoji: "🎀", order: 20,
    description: "하객 답례품",
    suggestedTiming: { earliestDaysBefore: 30, latestDaysBefore: 7 },
    estimatedCost: "5~20만원",
    checklistItems: [
      { id: "rg_1", title: "답례품 선택", description: "품목 결정", aiTip: "실용적인 게 좋아요", isRequired: false, order: 1 },
      { id: "rg_2", title: "주문", description: "수량 확인 후 주문", aiTip: "여유분 10% 더 주문하세요", isRequired: false, order: 2 },
    ],
    commonMistakes: ["수량 부족"],
    tips: ["명절 시즌에는 일찍 주문하세요"],
  },
];

// 카테고리 ID로 카테고리 찾기
export function getCategoryById(id: CategoryId): Category | undefined {
  return CATEGORIES.find((c) => c.id === id);
}

// 카테고리 이름 맵
export const CATEGORY_NAMES: Record<CategoryId, string> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c.name])
) as Record<CategoryId, string>;

// 카테고리 이모지 맵
export const CATEGORY_EMOJIS: Record<CategoryId, string> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c.emoji])
) as Record<CategoryId, string>;
