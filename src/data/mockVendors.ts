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
}

export interface Booking {
  id: string;
  vendorId: string;
  customerName: string;
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
