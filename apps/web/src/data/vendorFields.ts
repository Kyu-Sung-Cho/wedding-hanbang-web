// 업체 카테고리별 상품 필드 정의 + 헬퍼.
// (구 mockVendors.ts — mock 배열은 미사용 확인 후 삭제, 감사 2026-07-04 품질 훑기)

export type VendorCategory = "스튜디오" | "드레스" | "메이크업" | "예식장" | "한복" | "예물" | "신혼여행" | "기타";

// ─── 카테고리별 상품 시스템 ───

export type FieldType = "text" | "number" | "select" | "multiselect" | "boolean" | "textarea";

export interface ProductFieldDef {
  key: string;
  label: string;
  type: FieldType;
  options?: string[];
  unit?: string;
  placeholder?: string;
  required?: boolean;
  group?: string;
}

export interface CategoryProductConfig {
  productLabel: string;     // "촬영 패키지", "드레스 상품" 등
  productLabelPlural: string;
  icon: string;             // lucide icon name
  fields: ProductFieldDef[];
}

// 카테고리별 상품 필드 정의
export const CATEGORY_PRODUCT_FIELDS: Record<VendorCategory, CategoryProductConfig> = {
  "스튜디오": {
    productLabel: "촬영 패키지",
    productLabelPlural: "촬영 패키지",
    icon: "Camera",
    fields: [
      { key: "photographerRank", label: "촬영자 직급", type: "select", options: ["원장", "부원장", "실장", "수석", "팀장", "일반"], required: true, group: "촬영" },
      { key: "shootingHours", label: "촬영 시간", type: "select", options: ["1시간", "1.5시간", "2시간", "2.5시간", "3시간", "4시간", "종일"], required: true, group: "촬영" },
      { key: "conceptCount", label: "컨셉 수", type: "number", unit: "개", placeholder: "3", group: "촬영" },
      { key: "outfitCount", label: "의상 수", type: "number", unit: "벌", placeholder: "3", group: "촬영" },
      { key: "editedPhotos", label: "보정 컷 수", type: "number", unit: "컷", placeholder: "30", required: true, group: "결과물" },
      { key: "originalProvide", label: "원본 제공", type: "select", options: ["전체 제공", "일부 제공 (200컷 이상)", "미제공"], group: "결과물" },
      { key: "albumType", label: "앨범", type: "select", options: ["미포함", "10x10 (20p)", "10x10 (30p)", "12x12 (20p)", "12x12 (30p)", "14x14 (30p)", "14x14 (40p)"], group: "결과물" },
      { key: "additionalAlbum", label: "추가 앨범", type: "select", options: ["없음", "양가 부모님 앨범 2권", "미니앨범 2권"], group: "결과물" },
      { key: "frameType", label: "액자", type: "select", options: ["미포함", "11x14 1개", "16x20 1개", "20x24 1개", "세트 (3개)"], group: "결과물" },
      { key: "videoIncluded", label: "영상 촬영", type: "select", options: ["미포함", "하이라이트 (1분)", "하이라이트 (3분)", "풀영상 (10분+)", "시네마틱 무비"], group: "결과물" },
      { key: "hairMakeup", label: "헤어/메이크업 포함", type: "boolean", group: "포함 서비스" },
      { key: "outdoorAvailable", label: "야외촬영 가능", type: "boolean", group: "포함 서비스" },
      { key: "assistantIncluded", label: "어시스턴트 포함", type: "boolean", group: "포함 서비스" },
      { key: "additionalPersonFee", label: "추가 인원 비용", type: "number", unit: "만원/인", placeholder: "10", group: "추가 옵션" },
      { key: "retouchDelivery", label: "보정본 전달 기간", type: "select", options: ["2주", "3주", "4주", "6주", "8주"], group: "추가 옵션" },
    ],
  },
  "드레스": {
    productLabel: "드레스 상품",
    productLabelPlural: "드레스 상품",
    icon: "Shirt",
    fields: [
      { key: "dressType", label: "드레스 유형", type: "select", options: ["웨딩 드레스", "미니 드레스", "컬러 드레스", "예복 (턱시도)", "어머니 드레스"], required: true, group: "기본" },
      { key: "dressLine", label: "드레스 라인", type: "multiselect", options: ["A라인", "머메이드", "볼가운", "엠파이어", "슬림라인", "프린세스"], group: "기본" },
      { key: "grade", label: "등급", type: "select", options: ["기본", "프리미엄", "럭셔리", "디자이너", "수입 오리지널"], required: true, group: "기본" },
      { key: "brand", label: "브랜드/디자이너", type: "text", placeholder: "예: Vera Wang, Rosa Clara", group: "기본" },
      { key: "rentalPeriod", label: "대여 기간", type: "select", options: ["당일", "1박2일", "2박3일", "3박4일", "1주일"], required: true, group: "대여 조건" },
      { key: "fittingCount", label: "피팅 횟수", type: "select", options: ["1회", "2회", "3회", "무제한"], group: "대여 조건" },
      { key: "alterationIncluded", label: "수선 포함", type: "boolean", group: "대여 조건" },
      { key: "accessories", label: "포함 액세서리", type: "multiselect", options: ["베일", "글러브", "슈즈", "티아라", "이어링", "목걸이", "부케홀더"], group: "포함 항목" },
      { key: "undergarment", label: "속옷 제공", type: "select", options: ["미포함", "기본 속옷", "드레스용 속옷 세트"], group: "포함 항목" },
      { key: "additionalDress", label: "추가 드레스 대여", type: "select", options: ["불가", "1벌 추가 가능", "2벌 추가 가능"], group: "추가 옵션" },
      { key: "cleaningFee", label: "세탁비 별도", type: "boolean", group: "추가 옵션" },
      { key: "insuranceAvailable", label: "파손 보험 가능", type: "boolean", group: "추가 옵션" },
    ],
  },
  "메이크업": {
    productLabel: "메이크업 패키지",
    productLabelPlural: "메이크업 패키지",
    icon: "Palette",
    fields: [
      { key: "serviceType", label: "서비스 유형", type: "select", options: ["본식 메이크업", "리허설 메이크업", "스튜디오 촬영 메이크업", "본식+리허설 패키지", "올인원 패키지"], required: true, group: "기본" },
      { key: "includesHair", label: "헤어 포함", type: "boolean", group: "기본" },
      { key: "includesMakeup", label: "메이크업 포함", type: "boolean", group: "기본" },
      { key: "artistLevel", label: "아티스트 등급", type: "select", options: ["원장", "부원장", "실장", "수석", "일반"], required: true, group: "기본" },
      { key: "brideIncluded", label: "신부 시술", type: "boolean", group: "대상" },
      { key: "motherCount", label: "혼주 (어머니) 수", type: "select", options: ["미포함", "1명", "2명"], group: "대상" },
      { key: "familyMakeup", label: "가족 추가 시술", type: "select", options: ["불가", "1인 추가 가능", "2인 추가 가능", "3인 추가 가능"], group: "대상" },
      { key: "touchUpCount", label: "터치업 횟수", type: "select", options: ["없음", "1회", "2회", "무제한"], group: "서비스 상세" },
      { key: "onLocation", label: "출장 서비스", type: "select", options: ["매장 전용", "출장 가능 (추가비 없음)", "출장 가능 (추가비 별도)"], group: "서비스 상세" },
      { key: "consultIncluded", label: "사전 상담 포함", type: "boolean", group: "서비스 상세" },
      { key: "cosmeticsGrade", label: "사용 화장품 등급", type: "select", options: ["프로페셔널 라인", "백화점 브랜드", "하이엔드 (샤넬, 디올 등)"], group: "서비스 상세" },
      { key: "additionalPersonFee", label: "추가 인원 비용", type: "number", unit: "만원/인", placeholder: "15", group: "추가 옵션" },
    ],
  },
  "예식장": {
    productLabel: "웨딩홀 상품",
    productLabelPlural: "웨딩홀 상품",
    icon: "Building2",
    fields: [
      { key: "hallName", label: "홀 이름", type: "text", placeholder: "예: 그랜드볼룸", required: true, group: "기본" },
      { key: "hallType", label: "홀 타입", type: "select", options: ["그랜드홀", "컨벤션홀", "가든", "채플", "하우스 웨딩", "루프탑", "한옥"], required: true, group: "기본" },
      { key: "capacity", label: "수용 인원", type: "number", unit: "명", placeholder: "200", required: true, group: "기본" },
      { key: "ceremonyTime", label: "예식 시간", type: "select", options: ["60분", "90분", "120분", "무제한"], group: "기본" },
      { key: "mealType", label: "식사 타입", type: "select", options: ["뷔페", "한정식", "양식 코스", "중식", "퓨전"], required: true, group: "식사" },
      { key: "mealPricePerPerson", label: "식사 단가", type: "number", unit: "원/인", placeholder: "65000", group: "식사" },
      { key: "minGuarantee", label: "최소 보장 인원", type: "number", unit: "명", placeholder: "100", group: "식사" },
      { key: "basicDeco", label: "기본 데코 포함", type: "boolean", group: "시설" },
      { key: "decoGrade", label: "데코 등급", type: "select", options: ["기본", "프리미엄", "럭셔리", "커스텀"], group: "시설" },
      { key: "parkingSpaces", label: "주차 가능 대수", type: "number", unit: "대", placeholder: "100", group: "시설" },
      { key: "brideRoom", label: "신부 대기실", type: "boolean", group: "시설" },
      { key: "pyebaekRoom", label: "폐백실", type: "boolean", group: "시설" },
      { key: "outdoorAvailable", label: "야외 행사 가능", type: "boolean", group: "시설" },
      { key: "rentalFee", label: "대관료", type: "number", unit: "만원", placeholder: "300", group: "비용" },
    ],
  },
  "한복": {
    productLabel: "한복 상품",
    productLabelPlural: "한복 상품",
    icon: "Shirt",
    fields: [
      { key: "productType", label: "상품 유형", type: "select", options: ["대여", "맞춤 제작", "기성품 판매"], required: true, group: "기본" },
      { key: "target", label: "대상", type: "select", options: ["신부", "신랑", "혼주 (어머니)", "혼주 (아버지)", "가족"], required: true, group: "기본" },
      { key: "hanbokType", label: "한복 종류", type: "select", options: ["전통 한복", "현대 개량 한복", "퓨전 한복", "돌잔치 한복"], group: "기본" },
      { key: "fabric", label: "원단", type: "select", options: ["실크", "노방", "한산모시", "면", "옥사", "갑사"], group: "상세" },
      { key: "setComposition", label: "세트 구성", type: "multiselect", options: ["저고리", "치마", "바지", "마고자", "두루마기", "조끼"], required: true, group: "상세" },
      { key: "accessories", label: "포함 액세서리", type: "multiselect", options: ["노리개", "비녀", "족두리", "화관", "댕기", "버선"], group: "포함 항목" },
      { key: "rentalPeriod", label: "대여 기간", type: "select", options: ["당일", "1박2일", "2박3일", "1주일"], group: "대여 조건" },
      { key: "alterationIncluded", label: "수선/맞춤 포함", type: "boolean", group: "대여 조건" },
      { key: "cleaningIncluded", label: "세탁 포함", type: "boolean", group: "대여 조건" },
    ],
  },
  "예물": {
    productLabel: "예물 상품",
    productLabelPlural: "예물 상품",
    icon: "Gem",
    fields: [
      { key: "jewelryType", label: "상품 종류", type: "select", options: ["커플링", "웨딩밴드", "예물 반지", "목걸이", "귀걸이", "팔찌", "시계", "예물 세트"], required: true, group: "기본" },
      { key: "material", label: "소재", type: "select", options: ["18K 금", "14K 금", "백금 (Pt950)", "로즈골드", "실버", "티타늄"], required: true, group: "기본" },
      { key: "gemstone", label: "보석", type: "select", options: ["없음", "다이아몬드", "사파이어", "루비", "에메랄드", "진주", "큐빅"], group: "기본" },
      { key: "caratWeight", label: "캐럿 (ct)", type: "text", placeholder: "예: 0.3ct", group: "상세" },
      { key: "setType", label: "세트 구성", type: "select", options: ["단품", "커플 세트 (2개)", "예물 세트 (3종)", "풀 세트 (5종+)"], group: "상세" },
      { key: "customDesign", label: "커스텀/각인 가능", type: "boolean", group: "옵션" },
      { key: "sizeAdjustment", label: "사이즈 조절 가능", type: "boolean", group: "옵션" },
      { key: "certificate", label: "감정서 제공", type: "boolean", group: "옵션" },
      { key: "warranty", label: "A/S 보증", type: "select", options: ["없음", "6개월", "1년", "2년", "평생"], group: "옵션" },
    ],
  },
  "신혼여행": {
    productLabel: "신혼여행 패키지",
    productLabelPlural: "신혼여행 패키지",
    icon: "Plane",
    fields: [
      { key: "destination", label: "여행지", type: "text", placeholder: "예: 몰디브, 하와이", required: true, group: "기본" },
      { key: "duration", label: "여행 기간", type: "select", options: ["3박4일", "4박5일", "5박6일", "6박7일", "7박8일", "자유 설정"], required: true, group: "기본" },
      { key: "travelType", label: "여행 형태", type: "select", options: ["패키지 투어", "자유 여행", "세미 패키지", "허니문 전용"], group: "기본" },
      { key: "hotelGrade", label: "숙소 등급", type: "select", options: ["3성급", "4성급", "5성급", "리조트", "풀빌라"], group: "숙소" },
      { key: "roomType", label: "객실 타입", type: "select", options: ["스탠다드", "디럭스", "스위트", "풀빌라", "오버워터"], group: "숙소" },
      { key: "flightIncluded", label: "항공 포함", type: "boolean", group: "포함 항목" },
      { key: "flightClass", label: "항공 좌석", type: "select", options: ["이코노미", "프리미엄 이코노미", "비즈니스", "퍼스트"], group: "포함 항목" },
      { key: "mealIncluded", label: "식사 포함", type: "select", options: ["미포함", "조식만", "조식+석식", "올인클루시브"], group: "포함 항목" },
      { key: "tourIncluded", label: "투어/액티비티", type: "boolean", group: "포함 항목" },
      { key: "insuranceIncluded", label: "여행자 보험 포함", type: "boolean", group: "포함 항목" },
    ],
  },
  "기타": {
    productLabel: "상품",
    productLabelPlural: "상품",
    icon: "Package",
    fields: [
      { key: "serviceType", label: "서비스 종류", type: "text", placeholder: "예: 축가, 사회, 영상 촬영", required: true, group: "기본" },
      { key: "duration", label: "서비스 소요 시간", type: "text", placeholder: "예: 2시간", group: "기본" },
      { key: "onLocation", label: "출장 가능", type: "boolean", group: "옵션" },
      { key: "customizable", label: "맞춤 구성 가능", type: "boolean", group: "옵션" },
    ],
  },
};

// 소요시간 포맷 헬퍼
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}분`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}시간 ${m}분` : `${h}시간`;
}
