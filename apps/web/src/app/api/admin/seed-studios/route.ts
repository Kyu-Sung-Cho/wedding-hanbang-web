import { NextResponse } from "next/server";
import { verifyAdmin, getServiceClient } from "@/lib/utils/adminAuth";

const supabaseAdmin = getServiceClient();

// 스튜디오 시드 데이터 (서울/경기 위주 20곳)
const STUDIOS = [
  // ── 프리미엄 (4곳) ──
  { name: "스튜디오 라본", location: "서울 강남구", region: "서울", priceMin: 1500000, priceMax: 4500000, style: "감성", tags: ["감성", "필름", "강남"], desc: "필름 감성과 디지털 보정의 조화. 자연광 위주의 부드러운 톤이 특징. 강남 신사동 스튜디오." },
  { name: "에이프릴 스튜디오", location: "서울 강남구", region: "서울", priceMin: 1800000, priceMax: 5000000, style: "내추럴", tags: ["내추럴", "야외", "프리미엄"], desc: "압구정 본점. 실내 + 야외(보타닉 정원) 동시 촬영 가능. 부부의 자연스러운 모습을 담는다." },
  { name: "더 미러스 스튜디오", location: "서울 용산구", region: "서울", priceMin: 1700000, priceMax: 4800000, style: "모던", tags: ["모던", "에디토리얼", "한남동"], desc: "한남동 패션 화보 같은 모던 컨셉. 잡지 에디토리얼 스타일 전문." },
  { name: "디어모먼트", location: "서울 성동구", region: "서울", priceMin: 1600000, priceMax: 4500000, style: "필름", tags: ["필름", "성수", "감성"], desc: "성수동 갤러리 컨셉 스튜디오. 필름 카메라로 촬영 후 디지털 변환. 빈티지 감성." },

  // ── 중상급 (7곳) ──
  { name: "리브 인 스튜디오", location: "서울 마포구", region: "서울", priceMin: 900000, priceMax: 2500000, style: "내추럴", tags: ["내추럴", "홍대", "친근함"], desc: "홍대입구 5분. 친근한 분위기로 어색한 신랑도 편안하게 촬영." },
  { name: "스튜디오 마음", location: "서울 송파구", region: "서울", priceMin: 1100000, priceMax: 2800000, style: "감성", tags: ["감성", "잠실", "부부케미"], desc: "잠실역 도보 7분. 부부 케미 살리는 디렉팅 평이 좋음." },
  { name: "더 클래식 스튜디오", location: "서울 서초구", region: "서울", priceMin: 1200000, priceMax: 3000000, style: "클래식", tags: ["클래식", "전통", "양가부모"], desc: "서초동. 양가 부모님 마음에 드는 정통 클래식 톤." },
  { name: "팔레트 스튜디오", location: "서울 종로구", region: "서울", priceMin: 1000000, priceMax: 2700000, style: "모던", tags: ["모던", "북촌", "한옥"], desc: "북촌 한옥 + 모던 스튜디오 동시 보유. 한식 컨셉 가능." },
  { name: "썸원 스튜디오", location: "경기 성남시", region: "경기", priceMin: 950000, priceMax: 2400000, style: "내추럴", tags: ["분당", "내추럴", "주차"], desc: "분당 정자동. 차 가지고 가기 편한 위치, 주차 무료." },
  { name: "오픈리 스튜디오", location: "서울 강북구", region: "서울", priceMin: 850000, priceMax: 2200000, style: "감성", tags: ["감성", "수유", "강북"], desc: "수유역. 강북권 감성 스튜디오 대표주자." },
  { name: "포인트 스튜디오", location: "경기 고양시", region: "경기", priceMin: 900000, priceMax: 2300000, style: "모던", tags: ["일산", "모던", "넓은매장"], desc: "일산 라페스타. 100평 대형 매장에 다양한 컨셉 룸 보유." },

  // ── 중급 (6곳) ──
  { name: "달리 스튜디오", location: "서울 동작구", region: "서울", priceMin: 600000, priceMax: 1500000, style: "내추럴", tags: ["사당", "가성비", "내추럴"], desc: "사당역. 합리적 가격에 자연스러운 결과물." },
  { name: "더 데이 스튜디오", location: "서울 영등포구", region: "서울", priceMin: 700000, priceMax: 1700000, style: "클래식", tags: ["여의도", "클래식", "직장인"], desc: "여의도 직장인 신랑신부를 위한 평일 야간 촬영 가능." },
  { name: "스마일 스튜디오", location: "경기 수원시", region: "경기", priceMin: 650000, priceMax: 1600000, style: "감성", tags: ["수원", "감성", "경기남부"], desc: "수원역. 경기남부 가성비 스튜디오 평점 1위." },
  { name: "원더풀 스튜디오", location: "인천 남동구", region: "인천", priceMin: 600000, priceMax: 1500000, style: "내추럴", tags: ["인천", "구월동", "넓은공간"], desc: "인천 구월동 200평 매장. 야외 정원 같이 운영." },
  { name: "리얼 스튜디오", location: "서울 광진구", region: "서울", priceMin: 700000, priceMax: 1700000, style: "모던", tags: ["건대", "모던", "젊은감각"], desc: "건대입구. 젊은 감각의 모던 컨셉 전문." },
  { name: "메모리 스튜디오", location: "경기 부천시", region: "경기", priceMin: 600000, priceMax: 1400000, style: "클래식", tags: ["부천", "가성비", "클래식"], desc: "부천역. 부천/김포 신랑신부에게 인기." },

  // ── 가성비 (3곳) ──
  { name: "굿데이 스튜디오", location: "서울 도봉구", region: "서울", priceMin: 350000, priceMax: 900000, style: "심플", tags: ["초가성비", "도봉", "심플"], desc: "쌍문역. 깔끔하고 합리적. 50만원대 패키지로 입문용 인기." },
  { name: "행복 스튜디오", location: "경기 의정부시", region: "경기", priceMin: 400000, priceMax: 1000000, style: "내추럴", tags: ["의정부", "경기북부", "가성비"], desc: "의정부역. 경기 북부권 가성비 스튜디오." },
  { name: "라이트 스튜디오", location: "경기 안양시", region: "경기", priceMin: 380000, priceMax: 950000, style: "심플", tags: ["안양", "심플", "주말촬영"], desc: "안양역. 주말 촬영 슬롯 많음. 빠른 일정 가능." },
];

function generateStudioProducts(shop: typeof STUDIOS[0]) {
  const { priceMin, priceMax } = shop;
  const range = priceMax - priceMin;
  const products = [];

  if (priceMax >= 2500000) {
    // 프리미엄/중상급
    products.push({
      name: "베이직 패키지",
      description: "원판 200장 + 보정 30장. 가장 인기 있는 입문 패키지.",
      price: priceMin,
      original_price: Math.round(priceMin * 1.1),
      discount_price: null,
      is_popular: true,
      sort_order: 1,
      duration_minutes: 180,
      includes: ["촬영 3시간", "원판 200장 제공", "보정 30장", "USB 전달"],
      excludes: ["앨범 별도", "액자 별도", "원본 별도"],
      category_fields: { shoot_minutes: 180, raw_count: 200, retouch_count: 30 },
    });
    products.push({
      name: "프리미엄 패키지",
      description: "원판 300장 + 보정 50장 + 앨범 1권. 가장 많이 선택하는 옵션.",
      price: Math.round(priceMin + range * 0.5),
      original_price: Math.round((priceMin + range * 0.5) * 1.12),
      discount_price: null,
      is_popular: true,
      sort_order: 2,
      duration_minutes: 240,
      includes: ["촬영 4시간", "원판 300장", "보정 50장", "프리미엄 앨범 1권", "USB"],
      excludes: ["원본 USB 별도(15만원)", "액자 별도"],
      category_fields: { shoot_minutes: 240, raw_count: 300, retouch_count: 50 },
    });
    products.push({
      name: "올인원 패키지",
      description: "원판 500장 + 보정 80장 + 앨범 + 액자 2개 + 원본 USB. 풀세트.",
      price: priceMax,
      original_price: null,
      discount_price: null,
      is_popular: false,
      sort_order: 3,
      duration_minutes: 300,
      includes: ["촬영 5시간", "원판 500장 전부", "보정 80장", "앨범 + 액자 2개", "원본 USB 포함"],
      excludes: null,
      category_fields: { shoot_minutes: 300, raw_count: 500, retouch_count: 80 },
    });
  } else if (priceMax >= 1400000) {
    // 중급
    products.push({
      name: "베이직",
      description: "원판 150장 + 보정 20장. 가장 합리적인 선택.",
      price: priceMin,
      original_price: null,
      discount_price: null,
      is_popular: true,
      sort_order: 1,
      duration_minutes: 120,
      includes: ["촬영 2시간", "원판 150장", "보정 20장"],
      excludes: ["앨범 별도", "원본 별도"],
      category_fields: { shoot_minutes: 120, raw_count: 150, retouch_count: 20 },
    });
    products.push({
      name: "스탠다드",
      description: "원판 200장 + 보정 30장 + 앨범 1권.",
      price: Math.round(priceMin + range * 0.5),
      original_price: Math.round((priceMin + range * 0.5) * 1.1),
      discount_price: null,
      is_popular: true,
      sort_order: 2,
      duration_minutes: 180,
      includes: ["촬영 3시간", "원판 200장", "보정 30장", "앨범 1권"],
      excludes: ["원본 별도(10만원)"],
      category_fields: { shoot_minutes: 180, raw_count: 200, retouch_count: 30 },
    });
    products.push({
      name: "프리미엄",
      description: "원판 300장 + 보정 50장 + 앨범 + 액자.",
      price: priceMax,
      original_price: Math.round(priceMax * 1.1),
      discount_price: null,
      is_popular: false,
      sort_order: 3,
      duration_minutes: 240,
      includes: ["촬영 4시간", "원판 300장", "보정 50장", "앨범 + 액자 1개"],
      excludes: null,
      category_fields: { shoot_minutes: 240, raw_count: 300, retouch_count: 50 },
    });
  } else {
    // 가성비
    products.push({
      name: "심플 패키지",
      description: "원판 100장 + 보정 15장. 입문 가성비.",
      price: priceMin,
      original_price: null,
      discount_price: null,
      is_popular: true,
      sort_order: 1,
      duration_minutes: 120,
      includes: ["촬영 2시간", "원판 100장", "보정 15장"],
      excludes: ["앨범 별도", "원본 별도"],
      category_fields: { shoot_minutes: 120, raw_count: 100, retouch_count: 15 },
    });
    products.push({
      name: "스탠다드",
      description: "원판 150장 + 보정 25장 + 앨범.",
      price: priceMax,
      original_price: Math.round(priceMax * 1.15),
      discount_price: null,
      is_popular: true,
      sort_order: 2,
      duration_minutes: 180,
      includes: ["촬영 3시간", "원판 150장", "보정 25장", "앨범 1권"],
      excludes: ["원본 별도(8만원)"],
      category_fields: { shoot_minutes: 180, raw_count: 150, retouch_count: 25 },
    });
  }

  return products;
}

const DEFAULT_HOURS = {
  mon: "10:00-19:00",
  tue: "10:00-19:00",
  wed: "10:00-19:00",
  thu: "10:00-19:00",
  fri: "10:00-19:00",
  sat: "09:00-19:00",
  sun: "예약제",
};

function generateTimeslots(vendorId: string) {
  const slots = [];
  for (let day = 0; day <= 6; day++) {
    for (let hour = 9; hour <= 20; hour++) {
      const available = day <= 5 && hour >= 10 && hour <= 18;
      slots.push({
        vendor_id: vendorId,
        day,
        hour,
        available,
        max_bookings: available ? 2 : 0,
      });
    }
  }
  return slots;
}

export async function POST(req: Request) {
  const authHeader = req.headers.get("x-service-key");
  if (authHeader !== process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const { authorized } = await verifyAdmin(req);
    if (!authorized) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const results = { vendors: 0, products: 0, timeslots: 0, errors: [] as string[] };

  for (const shop of STUDIOS) {
    const { data: vendor, error: vendorError } = await supabaseAdmin
      .from("vendors")
      .insert({
        name: shop.name,
        category: "studio",
        location: shop.location,
        region: shop.region,
        address: `${shop.location} ${Math.floor(Math.random() * 200) + 1}번지`,
        phone: `02-${String(Math.floor(Math.random() * 9000) + 1000)}-${String(Math.floor(Math.random() * 9000) + 1000)}`,
        description: shop.desc,
        price_range: `${(shop.priceMin / 10000).toLocaleString()}~${(shop.priceMax / 10000).toLocaleString()}만원`,
        price_min: shop.priceMin,
        price_max: shop.priceMax,
        tags: shop.tags,
        style_tags: [shop.style],
        ai_recommend: true,
        status: "approved",
        business_hours: DEFAULT_HOURS,
        notification_settings: { booking: true, message: true, marketing: false },
      })
      .select("id")
      .single();

    if (vendorError) {
      results.errors.push(`업체 ${shop.name}: ${vendorError.message}`);
      continue;
    }

    results.vendors++;

    const products = generateStudioProducts(shop);
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
        results.errors.push(`상품 ${shop.name}/${product.name}: ${productError.message}`);
      } else {
        results.products++;
      }
    }

    const timeslots = generateTimeslots(vendor.id);
    const { error: slotError } = await supabaseAdmin
      .from("vendor_timeslots")
      .insert(timeslots);

    if (slotError) {
      results.errors.push(`타임슬롯 ${shop.name}: ${slotError.message}`);
    } else {
      results.timeslots += timeslots.length;
    }
  }

  return NextResponse.json({
    success: true,
    summary: `스튜디오 ${results.vendors}개, 상품 ${results.products}개, 타임슬롯 ${results.timeslots}개 생성`,
    ...results,
  });
}
