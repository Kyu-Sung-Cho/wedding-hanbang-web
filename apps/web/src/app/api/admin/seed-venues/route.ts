import { NextResponse } from "next/server";
import { verifyAdmin, getServiceClient, seedGate } from "@/lib/utils/adminAuth";

const supabaseAdmin = getServiceClient();

// 예식장 시드 데이터 (12곳, 식대 1인 기준)
const VENUES = [
  // ── 프리미엄 호텔 (3곳) ──
  { name: "더 프리미어 호텔", location: "서울 중구", region: "서울", priceMin: 130000, priceMax: 230000, style: "호텔", tags: ["호텔", "5성급", "남산"], desc: "남산 뷰 호텔 그랜드볼룸. 200~600명 수용. 프리미엄 케이터링 + 발렛 무료." },
  { name: "리브 호텔 그랜드볼룸", location: "서울 강남구", region: "서울", priceMin: 150000, priceMax: 250000, style: "호텔", tags: ["호텔", "강남", "프리미엄"], desc: "강남 5성 호텔. 천장 6m 그랜드볼룸. 단독홀 보장." },
  { name: "라 베니티 호텔", location: "서울 영등포구", region: "서울", priceMin: 125000, priceMax: 200000, style: "호텔", tags: ["여의도", "한강뷰", "호텔"], desc: "여의도 한강 뷰 호텔. 야외 가든 + 실내 홀 동시 사용 가능." },

  // ── 컨벤션/웨딩홀 (5곳) ──
  { name: "더 와이즈 컨벤션", location: "서울 송파구", region: "서울", priceMin: 70000, priceMax: 110000, style: "컨벤션", tags: ["잠실", "넓은홀", "주차"], desc: "잠실 컨벤션. 600명까지 수용. 평일 할인 큼." },
  { name: "이더 컨벤션 강서", location: "서울 강서구", region: "서울", priceMin: 65000, priceMax: 100000, style: "컨벤션", tags: ["마곡", "신축", "주차넉넉"], desc: "마곡나루역. 2024년 신축 컨벤션. 깨끗한 시설 + 넓은 주차장." },
  { name: "더 클래스 웨딩홀", location: "경기 성남시", region: "경기", priceMin: 60000, priceMax: 95000, style: "웨딩홀", tags: ["분당", "단독홀", "주차"], desc: "분당 정자동. 1일 1팀 단독홀 보장. 가성비 단독홀의 정석." },
  { name: "라 메종 웨딩", location: "경기 수원시", region: "경기", priceMin: 55000, priceMax: 90000, style: "웨딩홀", tags: ["수원", "경기남부", "넓은홀"], desc: "수원역 인근. 250명+ 수용. 경기남부 가성비 웨딩홀." },
  { name: "그랜드 베니티 컨벤션", location: "인천 남동구", region: "인천", priceMin: 55000, priceMax: 88000, style: "컨벤션", tags: ["인천", "구월동", "넓은홀"], desc: "인천 구월동. 인천/부천권 신혼부부 인기 1위." },

  // ── 가든/하우스 (2곳) ──
  { name: "포레스트 가든 웨딩", location: "경기 양평군", region: "경기", priceMin: 100000, priceMax: 180000, style: "가든", tags: ["야외", "양평", "스몰웨딩"], desc: "양평 숲 속 야외 웨딩. 50~150명 스몰웨딩 특화. 사진 화보급." },
  { name: "더 하우스 1957", location: "서울 종로구", region: "서울", priceMin: 110000, priceMax: 190000, style: "하우스", tags: ["북촌", "한옥", "스몰웨딩"], desc: "북촌 한옥. 80명 이내 스몰웨딩. 전통 + 모던 동시 가능." },

  // ── 스몰웨딩 전문 (2곳) ──
  { name: "메리 스몰 채플", location: "서울 마포구", region: "서울", priceMin: 90000, priceMax: 150000, style: "채플", tags: ["홍대", "채플", "스몰"], desc: "홍대 채플 스타일. 50~100명. 단독홀 보장 + 식사 자유 선택." },
  { name: "온더 가든 라운지", location: "서울 용산구", region: "서울", priceMin: 95000, priceMax: 160000, style: "라운지", tags: ["한남동", "라운지", "스몰"], desc: "한남동 모던 라운지. 60~120명. 칵테일 리셉션 + 디너 분리 가능." },
];

function generateVenueProducts(venue: typeof VENUES[0]) {
  const { priceMin, priceMax } = venue;
  const products = [];

  // 식대 기반 패키지 (인원 기준)
  products.push({
    name: "스탠다드 (식대 기준)",
    description: `1인당 ${priceMin.toLocaleString()}원 식대 기준. 최소 보증인원 적용.`,
    price: priceMin * 100, // 100명 기준 식대
    original_price: null,
    discount_price: null,
    is_popular: true,
    sort_order: 1,
    duration_minutes: 60,
    includes: ["대관료 포함", "기본 코스 식사", "사회자 1인", "사진 1대 (현장)", "본식 영상 1대"],
    excludes: ["꽃장식 별도", "본식 스냅 별도", "주차요금 별도"],
    category_fields: { meal_per_person: priceMin, min_guests: 100, hall_only: true },
  });

  products.push({
    name: "프리미엄 (식대 기준)",
    description: `1인당 ${Math.round((priceMin + priceMax) / 2).toLocaleString()}원 프리미엄 코스.`,
    price: Math.round((priceMin + priceMax) / 2) * 100,
    original_price: Math.round((priceMin + priceMax) / 2) * 100 * 1.1,
    discount_price: null,
    is_popular: true,
    sort_order: 2,
    duration_minutes: 60,
    includes: ["대관료 포함", "프리미엄 코스 (양식 + 한식 선택)", "사회자 1인", "사진 + 영상", "기본 꽃장식 포함"],
    excludes: ["본식 스냅 별도"],
    category_fields: { meal_per_person: Math.round((priceMin + priceMax) / 2), min_guests: 100 },
  });

  products.push({
    name: "VIP (식대 기준)",
    description: `1인당 ${priceMax.toLocaleString()}원 최고급 코스 + 풀 데코.`,
    price: priceMax * 100,
    original_price: null,
    discount_price: null,
    is_popular: false,
    sort_order: 3,
    duration_minutes: 90,
    includes: ["대관료 포함", "최고급 코스", "사회자/MC", "사진+영상+드론", "프리미엄 꽃장식", "신부대기실 데코", "발렛 무료"],
    excludes: null,
    category_fields: { meal_per_person: priceMax, min_guests: 100 },
  });

  return products;
}

const DEFAULT_HOURS = {
  mon: "10:00-20:00",
  tue: "10:00-20:00",
  wed: "10:00-20:00",
  thu: "10:00-20:00",
  fri: "10:00-20:00",
  sat: "09:00-21:00",
  sun: "10:00-21:00",
};

function generateTimeslots(vendorId: string) {
  const slots = [];
  for (let day = 0; day <= 6; day++) {
    for (let hour = 9; hour <= 21; hour++) {
      // 토/일은 본식, 평일은 상담만
      const isWeekend = day === 5 || day === 6;
      const available = isWeekend ? hour >= 11 && hour <= 19 : hour >= 10 && hour <= 19;
      slots.push({
        vendor_id: vendorId,
        day,
        hour,
        available,
        max_bookings: available ? (isWeekend ? 1 : 2) : 0,
      });
    }
  }
  return slots;
}

export async function POST(req: Request) {
  // 인증: 관리자 로그인만 허용. service_role_key 를 HTTP 헤더로 받는 bypass 제거.
  const { authorized } = await verifyAdmin(req);
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const gate = seedGate();
  if (gate) return gate;

  const results = { vendors: 0, products: 0, timeslots: 0, errors: [] as string[] };

  for (const venue of VENUES) {
    const { data: vendor, error: vendorError } = await supabaseAdmin
      .from("vendors")
      .insert({
        name: venue.name,
        category: "venue",
        location: venue.location,
        region: venue.region,
        address: `${venue.location} ${Math.floor(Math.random() * 200) + 1}번지`,
        phone: `02-${String(Math.floor(Math.random() * 9000) + 1000)}-${String(Math.floor(Math.random() * 9000) + 1000)}`,
        description: venue.desc,
        price_range: `식대 1인 ${(venue.priceMin / 10000).toFixed(1)}~${(venue.priceMax / 10000).toFixed(1)}만원`,
        price_min: venue.priceMin * 100, // 100명 기준 표시
        price_max: venue.priceMax * 100,
        tags: venue.tags,
        style_tags: [venue.style],
        ai_recommend: true,
        status: "approved",
        business_hours: DEFAULT_HOURS,
        notification_settings: { booking: true, message: true, marketing: false },
      })
      .select("id")
      .single();

    if (vendorError) {
      results.errors.push(`예식장 ${venue.name}: ${vendorError.message}`);
      continue;
    }

    results.vendors++;

    const products = generateVenueProducts(venue);
    for (const product of products) {
      const { error: productError } = await supabaseAdmin
        .from("vendor_products")
        .insert({
          vendor_id: vendor.id,
          ...product,
          is_active: true,
          images: [],
        });

      if (productError) {
        results.errors.push(`상품 ${venue.name}/${product.name}: ${productError.message}`);
      } else {
        results.products++;
      }
    }

    const timeslots = generateTimeslots(vendor.id);
    const { error: slotError } = await supabaseAdmin
      .from("vendor_timeslots")
      .insert(timeslots);

    if (slotError) {
      results.errors.push(`타임슬롯 ${venue.name}: ${slotError.message}`);
    } else {
      results.timeslots += timeslots.length;
    }
  }

  return NextResponse.json({
    success: true,
    summary: `예식장 ${results.vendors}개, 상품 ${results.products}개, 타임슬롯 ${results.timeslots}개 생성`,
    ...results,
  });
}
