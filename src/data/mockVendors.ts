export type VendorCategory = "스튜디오" | "드레스" | "메이크업" | "예식장" | "한복" | "예물" | "신혼여행" | "기타";
export type VendorStatus = "pending" | "approved" | "rejected";
export type BookingStatus = "confirmed" | "pending" | "completed" | "cancelled";

export interface TimeSlot {
  day: number; // 0=월 ~ 6=일
  hour: number; // 9~21
  available: boolean;
  maxBookings: number;
  currentBookings: number;
}

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

// 상품 인터페이스
export interface VendorProduct {
  id: string;
  vendorId: string;
  name: string;
  description: string;
  price: number;
  discountPrice?: number;
  isActive: boolean;
  isPopular: boolean;
  sortOrder: number;
  categoryFields: Record<string, string | number | boolean | string[]>;
  includes: string[];
  images: string[];
  createdAt: string;
}

export interface Vendor {
  id: string;
  name: string;
  category: VendorCategory;
  location: string;
  address: string;
  phone: string;
  ownerName: string;
  description: string;
  priceRange: string;
  priceMin: number;
  priceMax: number;
  rating: number;
  reviewCount: number;
  tags: string[];
  aiRecommend: boolean;
  status: VendorStatus;
  businessNumber: string;
  registeredAt: string;
  timeSlots: TimeSlot[];
  products: VendorProduct[];
}

export interface Booking {
  id: string;
  vendorId: string;
  customerName: string;
  customerPhone?: string;
  productId?: string;
  date: string;
  time: string;
  status: BookingStatus;
  memo: string;
  createdAt: string;
}

// 기본 주간 타임슬롯 생성
function generateDefaultSlots(pattern: "weekday-heavy" | "weekend-heavy" | "full"): TimeSlot[] {
  const slots: TimeSlot[] = [];
  for (let day = 0; day < 7; day++) {
    for (let hour = 9; hour <= 20; hour++) {
      const isWeekend = day >= 5;
      let available = false;
      if (pattern === "weekday-heavy") available = !isWeekend && hour >= 10 && hour <= 18;
      else if (pattern === "weekend-heavy") available = (isWeekend && hour >= 10 && hour <= 19) || (!isWeekend && hour >= 13 && hour <= 17);
      else available = hour >= 10 && hour <= 19;
      slots.push({ day, hour, available, maxBookings: 1, currentBookings: 0 });
    }
  }
  return slots;
}

// ─── Mock 상품 데이터 ───

const mockProductsStudio1: VendorProduct[] = [
  {
    id: "p1-1", vendorId: "v1", name: "베이직 촬영 패키지", description: "팀장급 포토그래퍼의 2시간 촬영. 기본에 충실한 자연광 스튜디오 촬영 패키지입니다.",
    price: 2500000, isActive: true, isPopular: false, sortOrder: 1, includes: ["보정 사진 20컷", "원본 일부 제공", "10x10 앨범 1권"], images: [], createdAt: "2025-12-01",
    categoryFields: { photographerRank: "팀장", shootingHours: "2시간", conceptCount: 2, outfitCount: 2, editedPhotos: 20, originalProvide: "일부 제공 (200컷 이상)", albumType: "10x10 (20p)", additionalAlbum: "없음", frameType: "미포함", videoIncluded: "미포함", hairMakeup: false, outdoorAvailable: false, assistantIncluded: false, additionalPersonFee: 10, retouchDelivery: "4주" },
  },
  {
    id: "p1-2", vendorId: "v1", name: "프리미엄 촬영 패키지", description: "실장급 포토그래퍼와 3시간 촬영. 야외촬영 포함, 3가지 컨셉으로 다양한 느낌을 담아드립니다.",
    price: 3200000, discountPrice: 2900000, isActive: true, isPopular: true, sortOrder: 2, includes: ["보정 사진 40컷", "원본 전체 제공", "12x12 앨범 1권", "양가 부모님 앨범 2권", "액자 1개"], images: [], createdAt: "2025-12-01",
    categoryFields: { photographerRank: "실장", shootingHours: "3시간", conceptCount: 3, outfitCount: 3, editedPhotos: 40, originalProvide: "전체 제공", albumType: "12x12 (30p)", additionalAlbum: "양가 부모님 앨범 2권", frameType: "16x20 1개", videoIncluded: "하이라이트 (1분)", hairMakeup: true, outdoorAvailable: true, assistantIncluded: true, additionalPersonFee: 10, retouchDelivery: "3주" },
  },
  {
    id: "p1-3", vendorId: "v1", name: "시그니처 촬영 패키지", description: "원장 직접 촬영. 4시간 촬영 + 시네마틱 영상까지 포함된 최고급 패키지입니다.",
    price: 4500000, isActive: true, isPopular: false, sortOrder: 3, includes: ["보정 사진 60컷", "원본 전체 제공", "14x14 앨범 1권", "양가 부모님 앨범 2권", "액자 세트", "시네마틱 무비"], images: [], createdAt: "2025-12-01",
    categoryFields: { photographerRank: "원장", shootingHours: "4시간", conceptCount: 5, outfitCount: 4, editedPhotos: 60, originalProvide: "전체 제공", albumType: "14x14 (40p)", additionalAlbum: "양가 부모님 앨범 2권", frameType: "세트 (3개)", videoIncluded: "시네마틱 무비", hairMakeup: true, outdoorAvailable: true, assistantIncluded: true, additionalPersonFee: 0, retouchDelivery: "2주" },
  },
];

const mockProductsDress3: VendorProduct[] = [
  {
    id: "p3-1", vendorId: "v3", name: "기본 드레스 대여", description: "국내 디자이너 드레스 기본 라인. 1회 피팅 포함.",
    price: 1500000, isActive: true, isPopular: false, sortOrder: 1, includes: ["드레스 1벌", "기본 베일", "1회 피팅"], images: [], createdAt: "2025-11-20",
    categoryFields: { dressType: "웨딩 드레스", dressLine: ["A라인", "슬림라인"], grade: "기본", brand: "", rentalPeriod: "2박3일", fittingCount: "1회", alterationIncluded: false, accessories: ["베일"], undergarment: "기본 속옷", additionalDress: "불가", cleaningFee: true, insuranceAvailable: false },
  },
  {
    id: "p3-2", vendorId: "v3", name: "프리미엄 드레스 대여", description: "수입 디자이너 드레스 프리미엄 라인. 전담 스타일리스트가 3회 피팅을 도와드립니다.",
    price: 2200000, discountPrice: 1980000, isActive: true, isPopular: true, sortOrder: 2, includes: ["드레스 1벌", "베일+글러브", "3회 피팅", "드레스용 속옷 세트", "수선 포함"], images: [], createdAt: "2025-11-20",
    categoryFields: { dressType: "웨딩 드레스", dressLine: ["A라인", "머메이드", "볼가운"], grade: "프리미엄", brand: "Rosa Clara", rentalPeriod: "3박4일", fittingCount: "3회", alterationIncluded: true, accessories: ["베일", "글러브", "슈즈"], undergarment: "드레스용 속옷 세트", additionalDress: "1벌 추가 가능", cleaningFee: false, insuranceAvailable: true },
  },
  {
    id: "p3-3", vendorId: "v3", name: "럭셔리 드레스 패키지", description: "해외 명품 드레스 + 미니 드레스 포함. 무제한 피팅과 풀 액세서리 세트.",
    price: 3500000, isActive: true, isPopular: false, sortOrder: 3, includes: ["웨딩 드레스 1벌", "미니 드레스 1벌", "풀 액세서리", "무제한 피팅", "수선+세탁 포함"], images: [], createdAt: "2025-11-20",
    categoryFields: { dressType: "웨딩 드레스", dressLine: ["A라인", "머메이드", "볼가운", "엠파이어"], grade: "럭셔리", brand: "Vera Wang", rentalPeriod: "1주일", fittingCount: "무제한", alterationIncluded: true, accessories: ["베일", "글러브", "슈즈", "티아라", "이어링"], undergarment: "드레스용 속옷 세트", additionalDress: "2벌 추가 가능", cleaningFee: false, insuranceAvailable: true },
  },
];

const mockProductsMakeup5: VendorProduct[] = [
  {
    id: "p5-1", vendorId: "v5", name: "본식 메이크업", description: "본식 당일 신부 메이크업+헤어. 실장급 아티스트가 담당합니다.",
    price: 800000, isActive: true, isPopular: false, sortOrder: 1, includes: ["신부 메이크업", "신부 헤어", "터치업 1회"], images: [], createdAt: "2025-12-10",
    categoryFields: { serviceType: "본식 메이크업", includesHair: true, includesMakeup: true, artistLevel: "실장", brideIncluded: true, motherCount: "미포함", familyMakeup: "불가", touchUpCount: "1회", onLocation: "출장 가능 (추가비 별도)", consultIncluded: false, cosmeticsGrade: "백화점 브랜드", additionalPersonFee: 15 },
  },
  {
    id: "p5-2", vendorId: "v5", name: "본식+리허설 패키지", description: "본식 + 리허설 메이크업 패키지. 사전 상담 포함으로 당일 완벽한 메이크업을 보장합니다.",
    price: 1200000, discountPrice: 1080000, isActive: true, isPopular: true, sortOrder: 2, includes: ["본식 메이크업+헤어", "리허설 메이크업+헤어", "사전 상담", "터치업 2회"], images: [], createdAt: "2025-12-10",
    categoryFields: { serviceType: "본식+리허설 패키지", includesHair: true, includesMakeup: true, artistLevel: "부원장", brideIncluded: true, motherCount: "미포함", familyMakeup: "1인 추가 가능", touchUpCount: "2회", onLocation: "출장 가능 (추가비 없음)", consultIncluded: true, cosmeticsGrade: "백화점 브랜드", additionalPersonFee: 15 },
  },
  {
    id: "p5-3", vendorId: "v5", name: "올인원 패키지", description: "신부 + 양가 어머니까지 모두 포함. 원장이 직접 시술하는 프리미엄 패키지.",
    price: 1800000, isActive: true, isPopular: false, sortOrder: 3, includes: ["신부 본식+리허설", "양가 어머니 2분", "사전 상담", "무제한 터치업", "하이엔드 화장품"], images: [], createdAt: "2025-12-10",
    categoryFields: { serviceType: "올인원 패키지", includesHair: true, includesMakeup: true, artistLevel: "원장", brideIncluded: true, motherCount: "2명", familyMakeup: "3인 추가 가능", touchUpCount: "무제한", onLocation: "출장 가능 (추가비 없음)", consultIncluded: true, cosmeticsGrade: "하이엔드 (샤넬, 디올 등)", additionalPersonFee: 0 },
  },
];

const mockProductsVenue6: VendorProduct[] = [
  {
    id: "p6-1", vendorId: "v6", name: "그랜드홀 패키지", description: "200명 수용 가능한 그랜드홀. 뷔페 식사와 기본 데코 포함.",
    price: 4500000, isActive: true, isPopular: true, sortOrder: 1, includes: ["그랜드홀 대관", "뷔페 식사 (200명)", "기본 꽃장식", "신부대기실", "주차 100대"], images: [], createdAt: "2025-11-01",
    categoryFields: { hallName: "그랜드홀", hallType: "그랜드홀", capacity: 200, ceremonyTime: "90분", mealType: "뷔페", mealPricePerPerson: 65000, minGuarantee: 150, basicDeco: true, decoGrade: "기본", parkingSpaces: 100, brideRoom: true, pyebaekRoom: true, outdoorAvailable: false, rentalFee: 300 },
  },
  {
    id: "p6-2", vendorId: "v6", name: "프리미엄 가든 패키지", description: "아름다운 야외 가든에서 진행되는 프리미엄 웨딩. 양식 코스와 럭셔리 데코.",
    price: 7000000, isActive: true, isPopular: false, sortOrder: 2, includes: ["가든 대관", "양식 코스 (150명)", "프리미엄 꽃장식", "신부대기실", "폐백실", "주차 150대"], images: [], createdAt: "2025-11-01",
    categoryFields: { hallName: "가든 테라스", hallType: "가든", capacity: 150, ceremonyTime: "120분", mealType: "양식 코스", mealPricePerPerson: 85000, minGuarantee: 100, basicDeco: true, decoGrade: "럭셔리", parkingSpaces: 150, brideRoom: true, pyebaekRoom: true, outdoorAvailable: true, rentalFee: 500 },
  },
];

const mockProductsHanbok8: VendorProduct[] = [
  {
    id: "p8-1", vendorId: "v8", name: "신부 한복 대여 (기본)", description: "실크 원단 신부 한복 세트. 노리개+비녀 포함.",
    price: 500000, isActive: true, isPopular: false, sortOrder: 1, includes: ["저고리+치마", "노리개", "비녀"], images: [], createdAt: "2026-01-15",
    categoryFields: { productType: "대여", target: "신부", hanbokType: "전통 한복", fabric: "실크", setComposition: ["저고리", "치마"], accessories: ["노리개", "비녀"], rentalPeriod: "2박3일", alterationIncluded: false, cleaningIncluded: true },
  },
  {
    id: "p8-2", vendorId: "v8", name: "양가 어머니 한복 (2벌 세트)", description: "양가 어머니 한복 세트 대여. 옥사 원단으로 고급스러움을 더했습니다.",
    price: 800000, discountPrice: 720000, isActive: true, isPopular: true, sortOrder: 2, includes: ["어머니 한복 2벌", "각 노리개", "수선 포함"], images: [], createdAt: "2026-01-15",
    categoryFields: { productType: "대여", target: "혼주 (어머니)", hanbokType: "전통 한복", fabric: "옥사", setComposition: ["저고리", "치마"], accessories: ["노리개"], rentalPeriod: "2박3일", alterationIncluded: true, cleaningIncluded: true },
  },
  {
    id: "p8-3", vendorId: "v8", name: "맞춤 한복 풀세트", description: "신부+신랑+양가 어머니 맞춤 제작. 프리미엄 실크 원단.",
    price: 2500000, isActive: true, isPopular: false, sortOrder: 3, includes: ["신부 한복", "신랑 한복", "양가 어머니 한복 2벌", "전체 액세서리", "맞춤 수선"], images: [], createdAt: "2026-01-15",
    categoryFields: { productType: "맞춤 제작", target: "가족", hanbokType: "전통 한복", fabric: "실크", setComposition: ["저고리", "치마", "바지", "마고자", "두루마기"], accessories: ["노리개", "비녀", "족두리", "화관"], rentalPeriod: "1주일", alterationIncluded: true, cleaningIncluded: true },
  },
];

export const mockVendors: Vendor[] = [
  {
    id: "v1",
    name: "로즈스튜디오",
    category: "스튜디오",
    location: "서울 강남구",
    address: "서울시 강남구 논현로 512, 3층",
    phone: "02-1234-5678",
    ownerName: "김영희",
    description: "자연광 전문 웨딩 스튜디오입니다. 10년 이상의 경험으로 자연스럽고 아름다운 웨딩 사진을 촬영합니다. 모든 촬영은 1:1 맞춤으로 진행됩니다.",
    priceRange: "250~350만원",
    priceMin: 2500000,
    priceMax: 3500000,
    rating: 4.8,
    reviewCount: 124,
    tags: ["자연광 전문", "보정 퀄리티", "1:1 촬영"],
    aiRecommend: true,
    status: "approved",
    businessNumber: "123-45-67890",
    registeredAt: "2025-12-01",
    timeSlots: generateDefaultSlots("weekend-heavy"),
    products: mockProductsStudio1,
  },
  {
    id: "v2",
    name: "블룸 웨딩 스튜디오",
    category: "스튜디오",
    location: "서울 서초구",
    address: "서울시 서초구 강남대로 234, 5층",
    phone: "02-2345-6789",
    ownerName: "이준호",
    description: "다양한 컨셉의 웨딩 촬영을 제공합니다. 실내 스튜디오와 야외 촬영 모두 가능하며, 드라마틱한 연출이 특장점입니다.",
    priceRange: "200~300만원",
    priceMin: 2000000,
    priceMax: 3000000,
    rating: 4.6,
    reviewCount: 89,
    tags: ["다양한 컨셉", "야외촬영", "드라마틱 연출"],
    aiRecommend: false,
    status: "approved",
    businessNumber: "234-56-78901",
    registeredAt: "2025-12-15",
    timeSlots: generateDefaultSlots("full"),
    products: [],
  },
  {
    id: "v3",
    name: "라비앙로즈 드레스",
    category: "드레스",
    location: "서울 강남구",
    address: "서울시 강남구 압구정로 78, 2층",
    phone: "02-3456-7890",
    ownerName: "박서연",
    description: "유럽 수입 드레스와 국내 디자이너 드레스를 갖추고 있습니다. 1:1 피팅 컨설팅으로 체형에 맞는 드레스를 찾아드립니다.",
    priceRange: "150~250만원",
    priceMin: 1500000,
    priceMax: 2500000,
    rating: 4.9,
    reviewCount: 201,
    tags: ["수입 드레스", "피팅 전문", "1:1 컨설팅"],
    aiRecommend: true,
    status: "approved",
    businessNumber: "345-67-89012",
    registeredAt: "2025-11-20",
    timeSlots: generateDefaultSlots("weekday-heavy"),
    products: mockProductsDress3,
  },
  {
    id: "v4",
    name: "그레이스 드레스샵",
    category: "드레스",
    location: "서울 종로구",
    address: "서울시 종로구 삼청로 45",
    phone: "02-4567-8901",
    ownerName: "최민지",
    description: "합리적인 가격으로 품격 있는 드레스를 제공합니다. 맞춤 제작도 가능하며, 양가 어머니 드레스도 함께 준비할 수 있습니다.",
    priceRange: "100~200만원",
    priceMin: 1000000,
    priceMax: 2000000,
    rating: 4.5,
    reviewCount: 67,
    tags: ["합리적 가격", "커스텀 가능", "어머니 드레스"],
    aiRecommend: false,
    status: "approved",
    businessNumber: "456-78-90123",
    registeredAt: "2026-01-05",
    timeSlots: generateDefaultSlots("full"),
    products: [],
  },
  {
    id: "v5",
    name: "뷰티풀 메이크업",
    category: "메이크업",
    location: "서울 강남구",
    address: "서울시 강남구 도산대로 156, 4층",
    phone: "02-5678-9012",
    ownerName: "정하늘",
    description: "본식 메이크업 전문 샵입니다. 리허설 포함 패키지로 당일 완벽한 메이크업을 보장합니다.",
    priceRange: "80~150만원",
    priceMin: 800000,
    priceMax: 1500000,
    rating: 4.7,
    reviewCount: 156,
    tags: ["본식 전문", "리허설 포함", "출장 가능"],
    aiRecommend: true,
    status: "approved",
    businessNumber: "567-89-01234",
    registeredAt: "2025-12-10",
    timeSlots: generateDefaultSlots("weekend-heavy"),
    products: mockProductsMakeup5,
  },
  {
    id: "v6",
    name: "더 베뉴 웨딩홀",
    category: "예식장",
    location: "서울 송파구",
    address: "서울시 송파구 올림픽로 300",
    phone: "02-6789-0123",
    ownerName: "한정우",
    description: "200명 이상 수용 가능한 대형 웨딩홀입니다. 넓은 주차장과 교통 편의성이 장점입니다.",
    priceRange: "400~600만원",
    priceMin: 4000000,
    priceMax: 6000000,
    rating: 4.4,
    reviewCount: 312,
    tags: ["대형 홀", "주차 편리", "교통 편리"],
    aiRecommend: false,
    status: "approved",
    businessNumber: "678-90-12345",
    registeredAt: "2025-11-01",
    timeSlots: generateDefaultSlots("full"),
    products: mockProductsVenue6,
  },
  {
    id: "v7",
    name: "아뜰리에 메이크업",
    category: "메이크업",
    location: "서울 마포구",
    address: "서울시 마포구 연남로 89, 2층",
    phone: "02-7890-1234",
    ownerName: "윤소희",
    description: "자연스러운 스타일의 메이크업을 추구합니다. 출장 서비스도 가능하며, 신부님의 개성을 살린 메이크업을 해드립니다.",
    priceRange: "60~120만원",
    priceMin: 600000,
    priceMax: 1200000,
    rating: 4.6,
    reviewCount: 93,
    tags: ["자연스러운 스타일", "출장 가능", "개성 메이크업"],
    aiRecommend: false,
    status: "pending",
    businessNumber: "789-01-23456",
    registeredAt: "2026-02-10",
    timeSlots: generateDefaultSlots("weekday-heavy"),
    products: [],
  },
  {
    id: "v8",
    name: "소담한복",
    category: "한복",
    location: "서울 종로구",
    address: "서울시 종로구 인사동길 33",
    phone: "02-8901-2345",
    ownerName: "김소담",
    description: "전통과 현대를 아우르는 맞춤 한복을 제작합니다. 양가 어머니 한복, 신부 한복 모두 가능합니다.",
    priceRange: "50~150만원",
    priceMin: 500000,
    priceMax: 1500000,
    rating: 4.8,
    reviewCount: 78,
    tags: ["맞춤 한복", "양가 어머니", "전통+현대"],
    aiRecommend: true,
    status: "approved",
    businessNumber: "890-12-34567",
    registeredAt: "2026-01-15",
    timeSlots: generateDefaultSlots("weekday-heavy"),
    products: mockProductsHanbok8,
  },
  {
    id: "v9",
    name: "스타일링 스튜디오",
    category: "스튜디오",
    location: "서울 용산구",
    address: "서울시 용산구 이태원로 210, 3층",
    phone: "02-9012-3456",
    ownerName: "장민석",
    description: "모던하고 세련된 웨딩 촬영을 전문으로 합니다.",
    priceRange: "300~400만원",
    priceMin: 3000000,
    priceMax: 4000000,
    rating: 4.3,
    reviewCount: 45,
    tags: ["모던 스타일", "세련된 연출"],
    aiRecommend: false,
    status: "pending",
    businessNumber: "901-23-45678",
    registeredAt: "2026-02-14",
    timeSlots: generateDefaultSlots("full"),
    products: [],
  },
  {
    id: "v10",
    name: "프리미엄 예물",
    category: "예물",
    location: "서울 중구",
    address: "서울시 중구 명동길 56, 7층",
    phone: "02-0123-4567",
    ownerName: "오진수",
    description: "프리미엄 웨딩 주얼리 전문점입니다. 반지, 목걸이, 시계 등 다양한 예물을 제공합니다.",
    priceRange: "200~500만원",
    priceMin: 2000000,
    priceMax: 5000000,
    rating: 4.7,
    reviewCount: 56,
    tags: ["프리미엄 주얼리", "맞춤 제작"],
    aiRecommend: false,
    status: "rejected",
    businessNumber: "012-34-56789",
    registeredAt: "2026-01-20",
    timeSlots: [],
    products: [],
  },
];

export const mockBookings: Booking[] = [
  { id: "b1", vendorId: "v1", customerName: "김○은", date: "2026-02-20", time: "14:00", status: "confirmed", memo: "스냅 촬영 상담", createdAt: "2026-02-15" },
  { id: "b2", vendorId: "v1", customerName: "이○수", date: "2026-02-20", time: "16:00", status: "pending", memo: "패키지 문의", createdAt: "2026-02-16" },
  { id: "b3", vendorId: "v1", customerName: "박○희", date: "2026-02-21", time: "11:00", status: "confirmed", memo: "본식 촬영 예약", createdAt: "2026-02-14" },
  { id: "b4", vendorId: "v1", customerName: "최○진", date: "2026-02-22", time: "13:00", status: "completed", memo: "리허설 촬영 완료", createdAt: "2026-02-10" },
  { id: "b5", vendorId: "v1", customerName: "정○아", date: "2026-02-19", time: "10:00", status: "cancelled", memo: "일정 변경으로 취소", createdAt: "2026-02-12" },
  { id: "b6", vendorId: "v1", customerName: "한○미", date: "2026-02-23", time: "15:00", status: "pending", memo: "야외 촬영 문의", createdAt: "2026-02-17" },
  { id: "b7", vendorId: "v1", customerName: "송○영", date: "2026-02-24", time: "11:00", status: "confirmed", memo: "앨범 상담", createdAt: "2026-02-16" },
];

export const VENDOR_CATEGORIES: VendorCategory[] = [
  "스튜디오", "드레스", "메이크업", "예식장", "한복", "예물", "신혼여행", "기타",
];

export const HOURS = Array.from({ length: 12 }, (_, i) => i + 9); // 9~20
export const DAYS = ["월", "화", "수", "목", "금", "토", "일"];
